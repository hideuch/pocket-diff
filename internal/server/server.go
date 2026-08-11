package server

import (
	"encoding/json"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"path"
	"strings"

	"github.com/hidenariTakeuchi/diff/internal/catalog"
	"github.com/hidenariTakeuchi/diff/internal/gitdiff"
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
	}

	s.serveAsset(response, request, localPath)
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
