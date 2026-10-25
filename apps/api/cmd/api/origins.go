package main

import (
	"net"
	"net/url"
)

// localOrigins adds this machine's addresses at the configured local web port.
func localOrigins(origins []string, addresses []net.Addr) []string {
	result := append([]string(nil), origins...)
	for _, origin := range origins {
		u, err := url.Parse(origin)
		if err != nil || u.Scheme != "http" || u.Hostname() != "localhost" {
			continue
		}
		for _, address := range addresses {
			ip, _, err := net.ParseCIDR(address.String())
			if err != nil || (!ip.IsLoopback() && !ip.IsPrivate()) {
				continue
			}
			alias := *u
			alias.Host = net.JoinHostPort(ip.String(), u.Port())
			result = append(result, alias.String())
		}
	}
	return result
}
