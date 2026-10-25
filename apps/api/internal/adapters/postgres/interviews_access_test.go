package postgres

import (
	"context"
	"encoding/base64"
	"strings"
	"testing"
)

func TestInterviewAdmissionLock(t *testing.T) {
	s, v := monitoringRoom(t)
	ctx := context.Background()
	token := strings.TrimPrefix(v.InvitePath, "/interview-invite/")
	if _, err := s.SetInterviewAdmission(ctx, "bob", v.ID, ID(), true); errorCode(err) != "forbidden" {
		t.Fatal("candidate locked room", err)
	}
	if _, err := s.SetInterviewMember(ctx, "alice", v.ID, ID(), "bob", "interviewer"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetInterviewAdmission(ctx, "bob", v.ID, ID(), true); errorCode(err) != "forbidden" {
		t.Fatal("nonhost locked room", err)
	}
	credentialBytes := make([]byte, 32)
	credentialBytes[0] = 1
	existingCredential := base64.RawURLEncoding.EncodeToString(credentialBytes)
	if _, err := s.JoinInterview(ctx, "", token, existingCredential, "Existing guest"); err != nil {
		t.Fatal(err)
	}
	key := ID()
	locked, err := s.SetInterviewAdmission(ctx, "alice", v.ID, key, true)
	if err != nil || !locked.AdmissionLocked {
		t.Fatal("lock", err)
	}
	if _, err = s.SetInterviewAdmission(ctx, "alice", v.ID, key, true); err != nil {
		t.Fatal("retry", err)
	}
	if _, err = s.JoinInterview(ctx, "charlie", token, "", ""); errorCode(err) != "admission_locked" {
		t.Fatal("account entered locked room", err)
	}
	if _, err = s.JoinInterview(ctx, "", token, existingCredential, "Existing guest"); err != nil {
		t.Fatal("existing guest blocked", err)
	}
	credential := base64.RawURLEncoding.EncodeToString(make([]byte, 32))
	if _, err = s.JoinInterview(ctx, "", token, credential, "Guest"); errorCode(err) != "admission_locked" {
		t.Fatal("guest entered locked room", err)
	}
	if _, err = s.JoinInterview(ctx, "bob", token, "", ""); err != nil {
		t.Fatal("existing member blocked", err)
	}
	if _, err = s.SetInterviewAdmission(ctx, "alice", v.ID, ID(), false); err != nil {
		t.Fatal(err)
	}
	if _, err = s.JoinInterview(ctx, "charlie", token, "", ""); err != nil {
		t.Fatal("unlock", err)
	}
}
