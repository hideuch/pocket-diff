//go:build release

package web

import (
	"embed"
	"io/fs"
)

//go:embed dist/*
var assets embed.FS

func Assets() fs.FS {
	result, _ := fs.Sub(assets, "dist")
	return result
}
