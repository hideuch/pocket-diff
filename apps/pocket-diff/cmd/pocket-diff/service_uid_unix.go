//go:build !windows

package main

import "os"

func currentUserID() int { return os.Getuid() }
