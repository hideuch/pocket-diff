package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/hidenariTakeuchi/diff/internal/catalog"
)

func TestNormalizeBasePath(t *testing.T) {
	for input, expected := range map[string]string{"/": "", "diff/": "/diff", "/review/code/": "/review/code"} {
		if actual := NormalizeBasePath(input); actual != expected {
			t.Fatalf("NormalizeBasePath(%q) = %q", input, actual)
		}
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
