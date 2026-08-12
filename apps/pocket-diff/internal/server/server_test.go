package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/hideuch/pocket-diff/apps/pocket-diff/internal/catalog"
	"github.com/hideuch/pocket-diff/apps/pocket-diff/internal/gitdiff"
)

func TestNormalizeBasePath(t *testing.T) {
	for input, expected := range map[string]string{"/": "", "diff/": "/diff", "/review/code/": "/review/code"} {
		if actual := NormalizeBasePath(input); actual != expected {
			t.Fatalf("NormalizeBasePath(%q) = %q", input, actual)
		}
	}
}

func TestServerReturnsWholeTextFile(t *testing.T) {
	repository := t.TempDir()
	gitServerTest(t, repository, "init", "-q")
	gitServerTest(t, repository, "config", "user.name", "Pocket Diff Test")
	gitServerTest(t, repository, "config", "user.email", "test@example.invalid")
	if err := os.WriteFile(filepath.Join(repository, "note.txt"), []byte("committed\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repository, "unchanged.txt"), []byte("private\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	gitServerTest(t, repository, "add", "note.txt", "unchanged.txt")
	gitServerTest(t, repository, "commit", "-qm", "initial")
	if err := os.WriteFile(filepath.Join(repository, "note.txt"), []byte("working tree\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	catalog := catalog.New([]string{repository}, 0)
	repositories := catalog.Scan(true)
	if len(repositories) != 1 {
		t.Fatalf("unexpected repositories: %+v", repositories)
	}
	handler := New(catalog, fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("ok")}}, "/diff")
	request := httptest.NewRequest(http.MethodGet, "/diff/api/file?repo="+repositories[0].ID+"&path=note.txt&source=working", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("unexpected response: %d %s", response.Code, response.Body.String())
	}
	var result struct {
		Content string `json:"content"`
		Path    string `json:"path"`
		Source  string `json:"source"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Content != "working tree\n" || result.Path != "note.txt" || result.Source != "working" {
		t.Fatalf("unexpected file response: %+v", result)
	}

	unchanged := httptest.NewRecorder()
	handler.ServeHTTP(unchanged, httptest.NewRequest(
		http.MethodGet,
		"/diff/api/file?repo="+repositories[0].ID+"&path=unchanged.txt&source=working",
		nil,
	))
	if unchanged.Code != http.StatusNotFound {
		t.Fatalf("unchanged file was exposed: %d %s", unchanged.Code, unchanged.Body.String())
	}
}

func TestServerStagesWithRevisionGuard(t *testing.T) {
	repository := t.TempDir()
	gitServerTest(t, repository, "init", "-q")
	gitServerTest(t, repository, "config", "user.name", "Pocket Diff Test")
	gitServerTest(t, repository, "config", "user.email", "test@example.invalid")
	if err := os.WriteFile(filepath.Join(repository, "note.txt"), []byte("before\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	gitServerTest(t, repository, "add", "note.txt")
	gitServerTest(t, repository, "commit", "-qm", "initial")
	if err := os.WriteFile(filepath.Join(repository, "note.txt"), []byte("after\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	catalog := catalog.New([]string{repository}, 0)
	repositories := catalog.Scan(true)
	handler := New(catalog, fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("ok")}}, "/diff")
	before, err := gitdiff.Collect(repository)
	if err != nil {
		t.Fatal(err)
	}
	requestBody, err := json.Marshal(map[string]string{
		"repo": repositories[0].ID, "statusRevision": before.StatusRevision,
		"changeToken": before.ChangeToken, "path": "note.txt",
	})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/diff/api/git/stage", bytes.NewReader(requestBody))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Sec-Fetch-Site", "same-origin")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("unexpected stage response: %d %s", response.Code, response.Body.String())
	}
	var staged gitdiff.StatusResult
	if err := json.Unmarshal(response.Body.Bytes(), &staged); err != nil {
		t.Fatal(err)
	}
	if staged.StatusRevision == before.StatusRevision || len(staged.FilesStatus) != 1 || staged.FilesStatus[0].Stage != "staged" {
		t.Fatalf("unexpected staged result: %+v", staged.FilesStatus)
	}

	stale := httptest.NewRecorder()
	handler.ServeHTTP(stale, httptest.NewRequest(http.MethodPost, "/diff/api/git/discard", bytes.NewReader(requestBody)))
	if stale.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("mutation without JSON content type was accepted: %d", stale.Code)
	}

	staleRequest := httptest.NewRequest(http.MethodPost, "/diff/api/git/discard", bytes.NewReader(requestBody))
	staleRequest.Header.Set("Content-Type", "application/json")
	staleResponse := httptest.NewRecorder()
	handler.ServeHTTP(staleResponse, staleRequest)
	if staleResponse.Code != http.StatusConflict {
		t.Fatalf("stale mutation was accepted: %d %s", staleResponse.Code, staleResponse.Body.String())
	}

	unstageBody, err := json.Marshal(map[string]string{
		"repo": repositories[0].ID, "statusRevision": staged.StatusRevision,
		"changeToken": staged.ChangeToken, "path": "note.txt",
	})
	if err != nil {
		t.Fatal(err)
	}
	unstageRequest := httptest.NewRequest(http.MethodPost, "/diff/api/git/unstage", bytes.NewReader(unstageBody))
	unstageRequest.Header.Set("Content-Type", "application/json")
	unstageResponse := httptest.NewRecorder()
	handler.ServeHTTP(unstageResponse, unstageRequest)
	if unstageResponse.Code != http.StatusOK {
		t.Fatalf("unexpected unstage response: %d %s", unstageResponse.Code, unstageResponse.Body.String())
	}
	var unstaged gitdiff.StatusResult
	if err := json.Unmarshal(unstageResponse.Body.Bytes(), &unstaged); err != nil {
		t.Fatal(err)
	}
	if len(unstaged.FilesStatus) != 1 || unstaged.FilesStatus[0].Stage != "unstaged" {
		t.Fatalf("unexpected unstaged result: %+v", unstaged.FilesStatus)
	}
}

func gitServerTest(t *testing.T, directory string, arguments ...string) {
	t.Helper()
	command := exec.Command("git", arguments...)
	command.Dir = directory
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v: %s", arguments, err, output)
	}
}

func TestServerSupportsSubpathAndSecurityHeaders(t *testing.T) {
	assets := fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<h1>Pocket Diff</h1>")}}
	handler := New(catalog.New([]string{t.TempDir()}, 0), assets, "/diff")

	redirect := httptest.NewRecorder()
	handler.ServeHTTP(redirect, httptest.NewRequest(http.MethodGet, "/diff", nil))
	if redirect.Code != http.StatusPermanentRedirect || redirect.Header().Get("Location") != "/diff/" {
		t.Fatalf("unexpected redirect: %d %s", redirect.Code, redirect.Header().Get("Location"))
	}

	health := httptest.NewRecorder()
	handler.ServeHTTP(health, httptest.NewRequest(http.MethodGet, "/diff/api/health", nil))
	if health.Code != http.StatusOK || !strings.Contains(health.Body.String(), `"ok":true`) {
		t.Fatalf("unexpected health response: %d %s", health.Code, health.Body.String())
	}
	if health.Header().Get("X-Frame-Options") != "DENY" {
		t.Fatal("security headers are missing")
	}

	rootHealth := httptest.NewRecorder()
	handler.ServeHTTP(rootHealth, httptest.NewRequest(http.MethodGet, "/api/health", nil))
	if rootHealth.Code != http.StatusOK {
		t.Fatalf("root API must remain available for path-stripping proxies: %d", rootHealth.Code)
	}
}
