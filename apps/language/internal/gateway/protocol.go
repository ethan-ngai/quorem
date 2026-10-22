// Package gateway brokers authenticated editor sessions to isolated language engines.
package gateway

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"unicode/utf8"
)

const maxMessage = 2 * 1024 * 1024

var methods = map[string]bool{"initialize": true, "initialized": true, "shutdown": true, "exit": true, "textDocument/didOpen": true, "textDocument/didChange": true, "textDocument/didClose": true, "textDocument/didSave": true, "textDocument/completion": true, "completionItem/resolve": true, "textDocument/hover": true, "textDocument/signatureHelp": true, "$/cancelRequest": true}

func validateMessage(data []byte) error {
	if len(data) > maxMessage || !utf8.Valid(data) {
		return errors.New("invalid message size or encoding")
	}
	var message map[string]any
	if json.Unmarshal(data, &message) != nil || message == nil || message["jsonrpc"] != "2.0" {
		return errors.New("invalid JSON-RPC message")
	}
	if method, ok := message["method"]; ok {
		name, valid := method.(string)
		if !valid || !methods[name] {
			return errors.New("unsupported method")
		}
	}
	return inspectURIs(message["params"], 0)
}
func inspectURIs(value any, depth int) error {
	if depth > 100 {
		return errors.New("message nesting exceeds limit")
	}
	switch v := value.(type) {
	case []any:
		for _, child := range v {
			if err := inspectURIs(child, depth+1); err != nil {
				return err
			}
		}
	case map[string]any:
		for key, child := range v {
			if key == "uri" || key == "rootUri" {
				if uri, ok := child.(string); ok && uri != "file:///workspace/main.py" && uri != "file:///workspace" && uri != "file:///workspace/" {
					return errors.New("foreign document")
				}
			}
			if key == "rootPath" && child != nil && child != "/workspace" {
				return errors.New("foreign workspace")
			}
			if err := inspectURIs(child, depth+1); err != nil {
				return err
			}
		}
	}
	return nil
}

func readFrame(reader *bufio.Reader) ([]byte, error) {
	size, length, seen := 0, 0, false
	for {
		line, err := reader.ReadSlice('\n')
		if err != nil {
			return nil, err
		}
		size += len(line)
		if size > 4096 {
			return nil, errors.New("frame header too large")
		}
		if bytes.Equal(line, []byte("\r\n")) {
			break
		}
		if !bytes.HasSuffix(line, []byte("\r\n")) {
			return nil, errors.New("invalid frame header")
		}
		key, value, ok := strings.Cut(strings.TrimSpace(string(line)), ":")
		if !ok {
			return nil, errors.New("invalid frame header")
		}
		if strings.EqualFold(key, "Content-Length") {
			if seen {
				return nil, errors.New("duplicate frame length")
			}
			seen = true
			length, err = strconv.Atoi(strings.TrimSpace(value))
			if err != nil || length < 0 || length > maxMessage {
				return nil, errors.New("invalid frame length")
			}
		}
	}
	if !seen {
		return nil, errors.New("missing frame length")
	}
	body := make([]byte, length)
	_, err := io.ReadFull(reader, body)
	if err == nil && (!utf8.Valid(body) || !json.Valid(body)) {
		return nil, errors.New("invalid frame body")
	}
	return body, err
}
func writeFrame(writer io.Writer, body []byte) error {
	if len(body) > maxMessage {
		return errors.New("frame exceeds limit")
	}
	_, err := fmt.Fprintf(writer, "Content-Length: %d\r\n\r\n", len(body))
	if err != nil {
		return err
	}
	_, err = io.Copy(writer, bytes.NewReader(body))
	return err
}
