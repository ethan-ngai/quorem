package realtime

import (
	"context"
	"errors"
	"sync"
	"time"
)

// Notice carries a durable change identity; adapters never transport private source.
type Notice struct {
	ID          string
	AggregateID string
	Version     string
	Type        string
	OccurredAt  time.Time
}

// PubSub permits a managed publisher/subscriber without changing match authority.
type PubSub interface {
	Publish(context.Context, string, Notice) error
	Subscribe(context.Context, string) (<-chan Notice, func(), error)
}

// Memory is the bounded local transport and advisory connection registry.
type Memory struct {
	mu          sync.Mutex
	subscribers map[string]map[chan Notice]struct{}
	connections map[string]map[string]int
	closed      bool
}

func NewMemory() *Memory {
	return &Memory{subscribers: make(map[string]map[chan Notice]struct{}), connections: make(map[string]map[string]int)}
}

func (m *Memory) Subscribe(ctx context.Context, topic string) (<-chan Notice, func(), error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed || ctx.Err() != nil {
		return nil, nil, errors.New("transport closed")
	}
	ch := make(chan Notice, 1)
	if m.subscribers[topic] == nil {
		m.subscribers[topic] = make(map[chan Notice]struct{})
	}
	m.subscribers[topic][ch] = struct{}{}
	var once sync.Once
	cancel := func() {
		once.Do(func() {
			m.mu.Lock()
			defer m.mu.Unlock()
			if _, ok := m.subscribers[topic][ch]; ok {
				delete(m.subscribers[topic], ch)
				close(ch)
			}
			if len(m.subscribers[topic]) == 0 {
				delete(m.subscribers, topic)
			}
		})
	}
	return ch, cancel, nil
}

func (m *Memory) Publish(ctx context.Context, topic string, notice Notice) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return errors.New("transport closed")
	}
	for ch := range m.subscribers[topic] {
		// Coalesce slow consumers; every notice triggers an authoritative snapshot.
		select {
		case ch <- notice:
		default:
			select {
			case <-ch:
			default:
			}
			ch <- notice
		}
	}
	return nil
}

func (m *Memory) Connect(topic, subject string) func() {
	m.mu.Lock()
	if m.connections[topic] == nil {
		m.connections[topic] = make(map[string]int)
	}
	m.connections[topic][subject]++
	m.mu.Unlock()
	var once sync.Once
	return func() {
		once.Do(func() {
			m.mu.Lock()
			defer m.mu.Unlock()
			m.connections[topic][subject]--
			if m.connections[topic][subject] <= 0 {
				delete(m.connections[topic], subject)
			}
			if len(m.connections[topic]) == 0 {
				delete(m.connections, topic)
			}
		})
	}
}

func (m *Memory) Online(topic, subject string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.connections[topic][subject] > 0
}

func (m *Memory) Close() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return
	}
	m.closed = true
	for _, subscribers := range m.subscribers {
		for ch := range subscribers {
			close(ch)
		}
	}
	m.subscribers = make(map[string]map[chan Notice]struct{})
}
