//go:build !release

package web

import (
	"embed"
	"io/fs"
)

//go:embed placeholder/*
var assets embed.FS

func Assets() fs.FS {
	result, _ := fs.Sub(assets, "placeholder")
	return result
}
