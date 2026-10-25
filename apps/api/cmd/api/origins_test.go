package main

import (
	"net"
	"slices"
	"testing"
)

func TestLocalOriginsOnlyAddsMachineAddressesAtWebPort(t *testing.T) {
	var addresses []net.Addr
	for _, value := range []string{"127.0.0.1/8", "10.48.12.195/24", "fd00::1/64", "203.0.113.1/24"} {
		ip, network, _ := net.ParseCIDR(value)
		network.IP = ip
		addresses = append(addresses, network)
	}
	origins := localOrigins([]string{"http://localhost:5180", "https://quorem.example"}, addresses)
	for _, origin := range []string{"http://localhost:5180", "http://127.0.0.1:5180", "http://10.48.12.195:5180", "http://[fd00::1]:5180", "https://quorem.example"} {
		if !slices.Contains(origins, origin) {
			t.Errorf("missing origin %s", origin)
		}
	}
	for _, origin := range []string{"http://10.48.12.196:5180", "http://10.48.12.195:5173", "http://203.0.113.1:5180", "https://10.48.12.195:5180"} {
		if slices.Contains(origins, origin) {
			t.Errorf("unexpected origin %s", origin)
		}
	}
	if got := localOrigins([]string{"https://quorem.example"}, addresses); len(got) != 1 {
		t.Fatalf("expanded nonlocal origin: %v", got)
	}
}
