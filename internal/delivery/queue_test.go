package delivery

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	"github.com/aws/aws-sdk-go-v2/service/sqs/types"
)

func TestCloudflareProtocol(t *testing.T) {
	var paths []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.Header.Get("Authorization") != "Bearer secret" || r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("invalid request headers")
		}
		paths = append(paths, r.URL.Path)
		var body map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		switch r.URL.Path {
		case "/accounts/account/queues/queue/messages":
			if string(body["content_type"]) != `"text"` || string(body["body"]) != `"{\"jobId\":\"job-1\"}"` {
				t.Errorf("publish body: %s", body)
			}
			fmt.Fprint(w, `{"success":true,"result":{}}`)
		case "/accounts/account/queues/queue/messages/pull":
			if string(body["batch_size"]) != "2" || string(body["visibility_timeout_ms"]) != "30000" {
				t.Errorf("pull body: %s", body)
			}
			encoded := base64.StdEncoding.EncodeToString([]byte(`{"jobId":"job-2"}`))
			fmt.Fprintf(w, `{"success":true,"result":{"messages":[{"body":"{\"jobId\":\"job-1\"}","lease_id":"receipt-1","metadata":{"CF-Content-Type":"text"}},{"body":%q,"lease_id":"receipt-2","metadata":{"CF-Content-Type":"json"}}]}}`, encoded)
		case "/accounts/account/queues/queue/messages/ack":
			if acks, ok := body["acks"]; ok {
				if string(acks) != `[{"lease_id":"receipt-1"}]` {
					t.Errorf("acks: %s", acks)
				}
				fmt.Fprint(w, `{"success":true,"result":{"ackCount":1}}`)
			} else {
				if string(body["retries"]) != `[{"delay_seconds":7,"lease_id":"receipt-2"}]` {
					t.Errorf("retry: %s", body["retries"])
				}
				fmt.Fprint(w, `{"success":true,"result":{"retryCount":1}}`)
			}
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
		}
	}))
	defer server.Close()
	queue, err := NewCloudflare(CloudflareConfig{AccountID: "account", QueueID: "queue", Token: "secret", BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err := queue.Publish(ctx, Notification{"job-1"}); err != nil {
		t.Fatal(err)
	}
	messages, err := queue.Receive(ctx, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 2 || messages[1].Notification.JobID != "job-2" || messages[0].Receipt != "receipt-1" {
		t.Fatalf("messages: %+v", messages)
	}
	if err := queue.Ack(ctx, messages[0].Receipt); err != nil {
		t.Fatal(err)
	}
	if err := queue.Retry(ctx, messages[1].Receipt, 7*time.Second); err != nil {
		t.Fatal(err)
	}
	if len(paths) != 4 {
		t.Fatalf("requests: %v", paths)
	}
}
func TestCloudflareFailsClosed(t *testing.T) {
	for _, body := range []string{`{"success":false,"errors":[{"message":"private provider detail"}]}`, `{"success":true,"result":{"messages":[{"body":"bad","lease_id":"receipt"}]}}`, `{"success":true,"result":{"messages":[{"body":"{\"jobId\":\"job\"}"}]}}`, string(make([]byte, 65537))} {
		t.Run(fmt.Sprint(len(body)), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, body) }))
			defer server.Close()
			q, _ := NewCloudflare(CloudflareConfig{AccountID: "a", QueueID: "q", Token: "secret", BaseURL: server.URL})
			if _, err := q.Receive(context.Background(), 1); err == nil {
				t.Fatal("accepted bad response")
			}
		})
	}
}
func TestCloudflareRejectsRedirect(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("followed credential-bearing redirect") }))
	defer target.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer server.Close()
	q, _ := NewCloudflare(CloudflareConfig{AccountID: "a", QueueID: "q", Token: "secret", BaseURL: server.URL})
	if err := q.Publish(context.Background(), Notification{"job"}); err == nil {
		t.Fatal("accepted redirect")
	}
}

type fakeSQS struct {
	send    *sqs.SendMessageInput
	receive *sqs.ReceiveMessageInput
	ack     *sqs.DeleteMessageInput
	retry   *sqs.ChangeMessageVisibilityInput
}

func (f *fakeSQS) SendMessage(_ context.Context, in *sqs.SendMessageInput, _ ...func(*sqs.Options)) (*sqs.SendMessageOutput, error) {
	f.send = in
	return &sqs.SendMessageOutput{}, nil
}
func (f *fakeSQS) ReceiveMessage(_ context.Context, in *sqs.ReceiveMessageInput, _ ...func(*sqs.Options)) (*sqs.ReceiveMessageOutput, error) {
	f.receive = in
	return &sqs.ReceiveMessageOutput{Messages: []types.Message{{Body: aws.String(`{"jobId":"job-1"}`), ReceiptHandle: aws.String("opaque")}}}, nil
}
func (f *fakeSQS) DeleteMessage(_ context.Context, in *sqs.DeleteMessageInput, _ ...func(*sqs.Options)) (*sqs.DeleteMessageOutput, error) {
	f.ack = in
	return &sqs.DeleteMessageOutput{}, nil
}
func (f *fakeSQS) ChangeMessageVisibility(_ context.Context, in *sqs.ChangeMessageVisibilityInput, _ ...func(*sqs.Options)) (*sqs.ChangeMessageVisibilityOutput, error) {
	f.retry = in
	return &sqs.ChangeMessageVisibilityOutput{}, nil
}
func TestSQSProtocol(t *testing.T) {
	client := &fakeSQS{}
	q, err := NewSQS(client, "queue-url")
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err = q.Publish(ctx, Notification{"job-1"}); err != nil {
		t.Fatal(err)
	}
	if aws.ToString(client.send.QueueUrl) != "queue-url" || aws.ToString(client.send.MessageBody) != `{"jobId":"job-1"}` {
		t.Fatalf("send: %+v", client.send)
	}
	messages, err := q.Receive(ctx, 3)
	if err != nil {
		t.Fatal(err)
	}
	if client.receive.MaxNumberOfMessages != 3 || client.receive.WaitTimeSeconds != 20 || client.receive.VisibilityTimeout != 30 || messages[0].Notification.JobID != "job-1" {
		t.Fatalf("receive: %+v", client.receive)
	}
	if err = q.Ack(ctx, messages[0].Receipt); err != nil {
		t.Fatal(err)
	}
	if aws.ToString(client.ack.ReceiptHandle) != "opaque" {
		t.Fatal("receipt changed")
	}
	if err = q.Retry(ctx, messages[0].Receipt, 7*time.Second); err != nil {
		t.Fatal(err)
	}
	if client.retry.VisibilityTimeout != 7 {
		t.Fatal("retry units")
	}
	for _, limit := range []int{0, 11} {
		if _, err = q.Receive(ctx, limit); err != ErrInvalid {
			t.Fatal("accepted invalid batch")
		}
	}
	if err = q.Retry(ctx, "receipt", time.Millisecond); err != ErrInvalid {
		t.Fatal("accepted fractional delay")
	}
}
func TestConfiguration(t *testing.T) {
	for _, provider := range []string{"", "polling"} {
		q, err := FromEnv(context.Background(), func(string) string { return provider })
		if err != nil || q != nil {
			t.Fatal("polling requested provider credentials")
		}
	}
	if _, err := FromEnv(context.Background(), func(string) string { return "unknown" }); err != ErrInvalid {
		t.Fatal("unknown provider accepted")
	}
	if _, err := NewCloudflare(CloudflareConfig{AccountID: "../secret", QueueID: "q", Token: "token"}); err != ErrInvalid {
		t.Fatal("unsafe account ID accepted")
	}
}
