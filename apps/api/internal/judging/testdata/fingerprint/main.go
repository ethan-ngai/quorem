package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"os"
)

func main() {
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 4096), 4<<20)
	for scanner.Scan() {
		var command judging.Command
		if err := json.Unmarshal(scanner.Bytes(), &command); err != nil {
			panic(err)
		}
		data, err := json.Marshal(command)
		if err != nil {
			panic(err)
		}
		fmt.Println(string(data))
	}
	if err := scanner.Err(); err != nil {
		panic(err)
	}
}
