package delivery

import (
	"context"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
)

type SQSClient interface {
	SendMessage(context.Context, *sqs.SendMessageInput, ...func(*sqs.Options)) (*sqs.SendMessageOutput, error)
	ReceiveMessage(context.Context, *sqs.ReceiveMessageInput, ...func(*sqs.Options)) (*sqs.ReceiveMessageOutput, error)
	DeleteMessage(context.Context, *sqs.DeleteMessageInput, ...func(*sqs.Options)) (*sqs.DeleteMessageOutput, error)
	ChangeMessageVisibility(context.Context, *sqs.ChangeMessageVisibilityInput, ...func(*sqs.Options)) (*sqs.ChangeMessageVisibilityOutput, error)
}
type SQS struct {
	client SQSClient
	url    string
}

func NewSQS(client SQSClient, queueURL string) (*SQS, error) {
	if client == nil || queueURL == "" {
		return nil, ErrInvalid
	}
	return &SQS{client, queueURL}, nil
}
func (q *SQS) Publish(ctx context.Context, n Notification) error {
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	body, err := encode(n)
	if err != nil {
		return err
	}
	_, err = q.client.SendMessage(ctx, &sqs.SendMessageInput{QueueUrl: aws.String(q.url), MessageBody: aws.String(body)})
	return err
}
func (q *SQS) Receive(ctx context.Context, limit int) ([]Message, error) {
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	if !validLimit(limit) {
		return nil, ErrInvalid
	}
	out, err := q.client.ReceiveMessage(ctx, &sqs.ReceiveMessageInput{QueueUrl: aws.String(q.url), MaxNumberOfMessages: int32(limit), WaitTimeSeconds: 20, VisibilityTimeout: 30})
	if err != nil {
		return nil, err
	}
	if out == nil || len(out.Messages) > limit {
		return nil, ErrUnavailable
	}
	messages := make([]Message, 0, len(out.Messages))
	for _, message := range out.Messages {
		n, err := decode(aws.ToString(message.Body))
		if err != nil {
			return nil, err
		}
		if aws.ToString(message.ReceiptHandle) == "" {
			return nil, ErrInvalid
		}
		messages = append(messages, Message{n, aws.ToString(message.ReceiptHandle)})
	}
	return messages, nil
}
func (q *SQS) Ack(ctx context.Context, receipt string) error {
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	if receipt == "" {
		return ErrInvalid
	}
	_, err := q.client.DeleteMessage(ctx, &sqs.DeleteMessageInput{QueueUrl: aws.String(q.url), ReceiptHandle: aws.String(receipt)})
	return err
}
func (q *SQS) Retry(ctx context.Context, receipt string, delay time.Duration) error {
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	if receipt == "" || !validDelay(delay) {
		return ErrInvalid
	}
	_, err := q.client.ChangeMessageVisibility(ctx, &sqs.ChangeMessageVisibilityInput{QueueUrl: aws.String(q.url), ReceiptHandle: aws.String(receipt), VisibilityTimeout: int32(delay / time.Second)})
	return err
}
