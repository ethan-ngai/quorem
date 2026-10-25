package realtime

import (
	"context"
	"errors"
	"strings"
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

// Presence is advisory and independent of durable participant state.
type Presence interface {
	Connect(string, string) (func(), error)
	Online(string, string) bool
}

// Memory is the bounded local transport and advisory connection registry.
type Memory struct {
	mu          sync.Mutex
	subscribers map[string]map[chan Notice]struct{}
	connections map[string]map[string]int
	closed      bool
	count       int
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
	limit := 8
	if strings.HasPrefix(topic, "/interviews/") {
		limit = 48
	}
	if m.count >= 256 || len(m.subscribers[topic]) >= limit {
		return nil, nil, errors.New("subscription capacity reached")
	}
	ch := make(chan Notice, 1)
	if m.subscribers[topic] == nil {
		m.subscribers[topic] = make(map[chan Notice]struct{})
	}
	m.subscribers[topic][ch] = struct{}{}
	m.count++
	var once sync.Once
	cancel := func() {
		once.Do(func() {
			m.mu.Lock()
			defer m.mu.Unlock()
			if _, ok := m.subscribers[topic][ch]; ok {
				delete(m.subscribers[topic], ch)
				m.count--
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
			case previous := <-ch:
				notice = CoalesceNotice(previous, notice)
			default:
			}
			ch <- notice
		}
	}
	return nil
}

func (m *Memory) Connect(topic, subject string) (func(), error) {
	m.mu.Lock()
	if m.closed || m.connections[topic][subject] >= 4 {
		m.mu.Unlock()
		return nil, errors.New("connection capacity reached")
	}
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
	}, nil
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

// CoalesceNotice retains an all-state wakeup when distinct interview changes share a buffer.
func CoalesceNotice(previous, next Notice) Notice {
	if strings.HasPrefix(next.Type, "interview.") && previous.Type != next.Type {
		next.Type = "interview.changed"
	}
	return next
}
