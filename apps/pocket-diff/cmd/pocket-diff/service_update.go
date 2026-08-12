package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"

	"github.com/hideuch/pocket-diff/apps/pocket-diff/internal/config"
)

type serviceUpdateResult struct {
	path         string
	synchronized bool
	restarted    bool
}

func updateInstalledService(ctx context.Context) (serviceUpdateResult, error) {
	path, configured, err := installedServiceExecutable()
	if err != nil || !configured {
		return serviceUpdateResult{}, err
	}
	result := serviceUpdateResult{path: path}
	current, err := os.Executable()
	if err != nil {
		return result, err
	}
	same, err := sameExecutable(current, path)
	if err != nil {
		return result, err
	}
	if !same {
		if runtime.GOOS == "windows" {
			_ = exec.Command("schtasks.exe", "/End", "/TN", "PocketDiff").Run()
		}
		command := exec.CommandContext(ctx, path, "update")
		command.Env = append(os.Environ(), skipServiceSyncEnvironment+"=1")
		command.Stdout = os.Stdout
		command.Stderr = os.Stderr
		if err := command.Run(); err != nil {
			return result, fmt.Errorf("update background service: %w", err)
		}
		result.synchronized = true
		if runtime.GOOS == "windows" {
			if err := waitForWindowsReplacement(ctx, path); err != nil {
				return result, err
			}
		}
	}
	if err := restartInstalledService(); err != nil {
		return result, fmt.Errorf("restart background service: %w", err)
	}
	result.restarted = true
	return result, nil
}

func waitForWindowsReplacement(ctx context.Context, path string) error {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		_, stagedErr := os.Stat(path + ".new")
		_, helperErr := os.Stat(path + ".update.cmd")
		if stagedErr != nil && !errors.Is(stagedErr, os.ErrNotExist) {
			return stagedErr
		}
		if helperErr != nil && !errors.Is(helperErr, os.ErrNotExist) {
			return helperErr
		}
		if errors.Is(stagedErr, os.ErrNotExist) && errors.Is(helperErr, os.ErrNotExist) {
			return nil
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("wait for background service update: %w", ctx.Err())
		case <-ticker.C:
		}
	}
}

func installedServiceExecutable() (string, bool, error) {
	home, err := config.Home()
	if err != nil {
		return "", false, err
	}
	value, err := config.Load(filepath.Join(home, "config.json"))
	if errors.Is(err, os.ErrNotExist) || (err == nil && !value.Service) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	for _, name := range serviceExecutableNames(runtime.GOOS) {
		candidate := filepath.Join(home, "bin", name)
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, true, nil
		} else if err != nil && !errors.Is(err, os.ErrNotExist) {
			return "", false, err
		}
	}
	return "", false, nil
}

func serviceExecutableNames(goos string) []string {
	if goos == "windows" {
		return []string{"pcdiff.exe", "pocket-diff.exe"}
	}
	return []string{"pcdiff", "pocket-diff"}
}

func sameExecutable(left, right string) (bool, error) {
	leftPath, err := filepath.EvalSymlinks(left)
	if err != nil {
		return false, err
	}
	rightPath, err := filepath.EvalSymlinks(right)
	if err != nil {
		return false, err
	}
	leftInfo, err := os.Stat(leftPath)
	if err != nil {
		return false, err
	}
	rightInfo, err := os.Stat(rightPath)
	if err != nil {
		return false, err
	}
	return os.SameFile(leftInfo, rightInfo), nil
}

func restartInstalledService() error {
	commands, err := serviceRestartCommands(runtime.GOOS, currentUserID())
	if err != nil {
		return err
	}
	for index, command := range commands {
		err := exec.Command(command.name, command.arguments...).Run()
		if err != nil && !(runtime.GOOS == "windows" && index == 0) {
			return err
		}
	}
	return nil
}

type serviceCommand struct {
	name      string
	arguments []string
}

func serviceRestartCommands(goos string, uid int) ([]serviceCommand, error) {
	switch goos {
	case "darwin":
		return []serviceCommand{{"launchctl", []string{"kickstart", "-k", fmt.Sprintf("gui/%d/com.pocket-diff", uid)}}}, nil
	case "linux":
		return []serviceCommand{{"systemctl", []string{"--user", "restart", "pocket-diff.service"}}}, nil
	case "windows":
		return []serviceCommand{
			{"schtasks.exe", []string{"/End", "/TN", "PocketDiff"}},
			{"schtasks.exe", []string{"/Run", "/TN", "PocketDiff"}},
		}, nil
	default:
		return nil, fmt.Errorf("service restart is not supported on %s", goos)
	}
}
