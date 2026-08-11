//go:build !windows

package uninstall

import "os"

func userID() int { return os.Getuid() }
