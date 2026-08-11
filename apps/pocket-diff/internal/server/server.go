package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"path"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/hideuch/pocket-diff/apps/pocket-diff/internal/catalog"
	"github.com/hideuch/pocket-diff/apps/pocket-diff/internal/gitdiff"
)

type Server struct {
	catalog  *catalog.Catalog
	assets   fs.FS
	basePath string
}

func New(catalog *catalog.Catalog, assets fs.FS, basePath string) http.Handler {
	basePath = NormalizeBasePath(basePath)
	server := &Server{catalog: catalog, assets: assets, basePath: basePath}
	return securityHeaders(server)
}

func NormalizeBasePath(value string) string {
	value = strings.Trim(value, "/")
	if value == "" {
		return ""
	}
	return "/" + value
}

func (s *Server) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	requestPath := request.URL.Path
	localPath := requestPath
	if s.basePath != "" {
		if requestPath == s.basePath {
			http.Redirect(response, request, s.basePath+"/", http.StatusPermanentRedirect)
			return
		}
		if strings.HasPrefix(requestPath, s.basePath+"/") {
			localPath = strings.TrimPrefix(requestPath, s.basePath)
		}
	}

	switch localPath {
	case "/api/health":
		writeJSON(response, http.StatusOK, map[string]bool{"ok": true})
		return
	case "/api/repos":
		response.Header().Set("Cache-Control", "private, no-cache")
		writeJSON(response, http.StatusOK, map[string]any{"repositories": s.catalog.Scan(request.URL.Query().Get("refresh") == "1")})
		return
	case "/api/diff":
		response.Header().Set("Cache-Control", "private, no-cache")
		repositoryPath, ok := s.catalog.Resolve(request.URL.Query().Get("repo"))
		if !ok {
			writeJSON(response, http.StatusNotFound, map[string]string{"error": "リポジトリが見つかりません", "detail": "一覧から選び直してください"})
			return
		}
		result, err := gitdiff.Collect(repositoryPath)
		if err != nil {
			writeJSON(response, http.StatusUnprocessableEntity, map[string]string{"error": "差分を読み込めませんでした", "detail": err.Error()})
			return
		}
		etag := `"` + result.Revision + `"`
		response.Header().Set("ETag", etag)
		if request.Header.Get("If-None-Match") == etag {
			response.WriteHeader(http.StatusNotModified)
			return
		}
		writeJSON(response, http.StatusOK, result)
		return
	case "/api/image":
		s.serveImage(response, request)
		return
	case "/api/file":
		s.serveFile(response, request)
		return
	}

	s.serveAsset(response, request, localPath)
}

const maxTextPreviewBytes = 2 * 1024 * 1024

func (s *Server) serveFile(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		response.Header().Set("Allow", "GET")
		writeJSON(response, http.StatusMethodNotAllowed, map[string]string{"error": "対応していないリクエストです"})
		return
	}
	repositoryPath, ok := s.catalog.Resolve(request.URL.Query().Get("repo"))
	if !ok {
		writeJSON(response, http.StatusNotFound, map[string]string{"error": "リポジトリが見つかりません"})
		return
	}
	name := request.URL.Query().Get("path")
	source := request.URL.Query().Get("source")
	if !gitdiff.IsChangedFile(repositoryPath, name) {
		writeJSON(response, http.StatusNotFound, map[string]string{"error": "変更中のファイルが見つかりません"})
		return
	}
	content, err := gitdiff.ReadFileVersion(repositoryPath, name, source)
	if err != nil {
		writeJSON(response, http.StatusNotFound, map[string]string{"error": "ファイルを読み込めませんでした"})
		return
	}
	if len(content) > maxTextPreviewBytes {
		writeJSON(response, http.StatusRequestEntityTooLarge, map[string]string{
			"error":  "ファイルが大きすぎます",
			"detail": "ファイル全体の表示は2MBまで対応しています",
		})
		return
	}
	if !utf8.Valid(content) || bytes.IndexByte(content, 0) >= 0 {
		writeJSON(response, http.StatusUnsupportedMediaType, map[string]string{"error": "バイナリファイルはテキスト表示できません"})
		return
	}
	response.Header().Set("Cache-Control", "private, no-cache")
	writeJSON(response, http.StatusOK, map[string]any{
		"content": string(content),
		"path":    name,
		"source":  source,
		"size":    len(content),
	})
}

var imageMediaTypes = map[string]string{
	".avif": "image/avif",
	".bmp":  "image/bmp",
	".gif":  "image/gif",
	".ico":  "image/x-icon",
	".jpeg": "image/jpeg",
	".jpg":  "image/jpeg",
	".png":  "image/png",
	".svg":  "image/svg+xml",
	".webp": "image/webp",
}

func (s *Server) serveImage(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		response.Header().Set("Allow", "GET, HEAD")
		writeJSON(response, http.StatusMethodNotAllowed, map[string]string{"error": "対応していないリクエストです"})
		return
	}
	name := request.URL.Query().Get("path")
	mediaType, ok := imageMediaTypes[strings.ToLower(filepath.Ext(name))]
	if !ok {
		writeJSON(response, http.StatusUnsupportedMediaType, map[string]string{"error": "プレビューできない画像形式です"})
		return
	}
	repositoryPath, ok := s.catalog.Resolve(request.URL.Query().Get("repo"))
	if !ok {
		writeJSON(response, http.StatusNotFound, map[string]string{"error": "リポジトリが見つかりません"})
		return
	}
	if !gitdiff.IsChangedFile(repositoryPath, name) {
		writeJSON(response, http.StatusNotFound, map[string]string{"error": "変更中の画像が見つかりません"})
		return
	}
	content, err := gitdiff.ReadFileVersion(repositoryPath, name, request.URL.Query().Get("source"))
	if err != nil {
		writeJSON(response, http.StatusNotFound, map[string]string{"error": "画像を読み込めませんでした"})
		return
	}
	response.Header().Set("Cache-Control", "private, no-cache")
	response.Header().Set("Content-Type", mediaType)
	response.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	response.Header().Set("Content-Length", fmt.Sprintf("%d", len(content)))
	if request.Method == http.MethodHead {
		response.WriteHeader(http.StatusOK)
		return
	}
	_, _ = response.Write(content)
}

func (s *Server) serveAsset(response http.ResponseWriter, request *http.Request, localPath string) {
	name := strings.TrimPrefix(path.Clean(localPath), "/")
	if name == "." || name == "" {
		name = "index.html"
	}
	content, err := fs.ReadFile(s.assets, name)
	if err != nil {
		name = "index.html"
		content, err = fs.ReadFile(s.assets, name)
	}
	if err != nil {
		log.Printf("embedded UI unavailable: %v", err)
		http.Error(response, "UI unavailable", http.StatusInternalServerError)
		return
	}
	if mediaType := mime.TypeByExtension(path.Ext(name)); mediaType != "" {
		response.Header().Set("Content-Type", mediaType)
	}
	if name != "index.html" {
		response.Header().Set("Cache-Control", "private, max-age=3600")
	}
	_, _ = response.Write(content)
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Content-Type", "application/json; charset=utf-8")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("X-Content-Type-Options", "nosniff")
		response.Header().Set("Referrer-Policy", "no-referrer")
		response.Header().Set("X-Frame-Options", "DENY")
		response.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'")
		next.ServeHTTP(response, request)
	})
}
