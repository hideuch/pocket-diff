package updater

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestIsNewerPreventsDowngrades(t *testing.T) {
	cases := []struct {
		current string
		latest  string
		want    bool
	}{
		{"v0.2.0", "v0.3.0", true},
		{"v1.0.0", "v1.0.0", false},
		{"v2.0.0", "v1.9.9", false},
		{"v1.2.3", "v1.2.4", true},
	}
	for _, test := range cases {
		got, err := isNewer(test.current, test.latest)
		if err != nil {
			t.Fatalf("isNewer(%q, %q): %v", test.current, test.latest, err)
		}
		if got != test.want {
			t.Fatalf("isNewer(%q, %q) = %t, want %t", test.current, test.latest, got, test.want)
		}
	}
}

func TestCheckUsesOfficialRepositoryAndRejectsDevelopmentBuild(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/repos/"+Repository+"/releases/latest" {
			t.Fatalf("unexpected path: %s", request.URL.Path)
		}
		json.NewEncoder(response).Encode(Release{TagName: "v0.3.0"})
	}))
	defer server.Close()
	client := Client{HTTPClient: server.Client(), APIBase: server.URL, GOOS: "linux", GOARCH: "amd64"}
	release, newer, err := client.Check(context.Background(), "v0.2.0")
	if err != nil || !newer || release.TagName != "v0.3.0" {
		t.Fatalf("unexpected check result: release=%+v newer=%t err=%v", release, newer, err)
	}
	if _, _, err := client.Check(context.Background(), "dev"); err != ErrDevelopmentBuild {
		t.Fatalf("development build error = %v", err)
	}
}

func TestCheckRejectsUnprotectedTag(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		json.NewEncoder(response).Encode(Release{TagName: "0.3.0"})
	}))
	defer server.Close()
	client := Client{HTTPClient: server.Client(), APIBase: server.URL}
	if _, _, err := client.Check(context.Background(), "v0.2.0"); err == nil {
		t.Fatal("release outside the protected v* namespace was accepted")
	}
}

func TestExtractBinaryFromTarGzip(t *testing.T) {
	want := []byte("trusted pocket diff binary")
	var archive bytes.Buffer
	gzipWriter := gzip.NewWriter(&archive)
	tarWriter := tar.NewWriter(gzipWriter)
	if err := tarWriter.WriteHeader(&tar.Header{Name: "pocket-diff_linux_amd64/pcdiff", Mode: 0o755, Size: int64(len(want))}); err != nil {
		t.Fatal(err)
	}
	if _, err := tarWriter.Write(want); err != nil {
		t.Fatal(err)
	}
	if err := tarWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	got, err := extractBinary(archive.Bytes(), "pocket-diff_linux_amd64.tar.gz")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("extracted %q, want %q", got, want)
	}
}

func TestArchiveNameAllowsOnlyReleasedTargets(t *testing.T) {
	if got, _ := archiveName("darwin", "arm64"); got != "pocket-diff_darwin_arm64.tar.gz" {
		t.Fatalf("unexpected archive: %s", got)
	}
	if got, _ := archiveName("windows", "amd64"); got != "pocket-diff_windows_amd64.zip" {
		t.Fatalf("unexpected archive: %s", got)
	}
	if _, err := archiveName("linux", "386"); err == nil {
		t.Fatal("unsupported target was accepted")
	}
}
