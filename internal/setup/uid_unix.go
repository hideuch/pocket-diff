//go:build !windows

package setup

import "os"

func userID() int { return os.Getuid() }
