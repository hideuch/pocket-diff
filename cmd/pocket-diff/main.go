package main

import (
	"errors"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/hidenariTakeuchi/diff/internal/catalog"
	"github.com/hidenariTakeuchi/diff/internal/config"
	"github.com/hidenariTakeuchi/diff/internal/server"
	"github.com/hidenariTakeuchi/diff/internal/setup"
	"github.com/hidenariTakeuchi/diff/internal/web"
)

var version = "dev"

type rootsFlag []string

func (values *rootsFlag) String() string { return strings.Join(*values, string(os.PathListSeparator)) }
func (values *rootsFlag) Set(value string) error {
	absolute, err := filepath.Abs(value)
	if err != nil {
		return err
	}
	*values = append(*values, absolute)
	return nil
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "Pocket Diff:", err)
		os.Exit(1)
	}
}

func run(arguments []string) error {
	command := "serve"
	if len(arguments) > 0 && !strings.HasPrefix(arguments[0], "-") {
		command, arguments = arguments[0], arguments[1:]
	}
	switch command {
	case "serve":
		return serve(arguments)
	case "setup":
		options, err := setup.ParseOptions(arguments)
		if err != nil {
			return err
		}
		return setup.Run(options, os.Stdin, os.Stdout)
	case "doctor":
		return doctor()
	case "version", "--version", "-v":
		fmt.Println("pocket-diff", version, runtime.GOOS+"/"+runtime.GOARCH)
		return nil
	case "help", "--help", "-h":
		usage()
		return nil
	default:
		return fmt.Errorf("unknown command: %s", command)
	}
}

func serve(arguments []string) error {
	set := flag.NewFlagSet("serve", flag.ContinueOnError)
	var roots rootsFlag
	var configPath, host, basePath string
	var port, depth int
	set.Var(&roots, "root", "Git repository parent folder (repeatable)")
	set.StringVar(&configPath, "config", "", "configuration file")
	set.StringVar(&host, "host", "127.0.0.1", "listen host")
	set.StringVar(&basePath, "base-path", "", "URL base path")
	set.IntVar(&port, "port", 4173, "listen port")
	set.IntVar(&depth, "depth", 4, "repository scan depth")
	if err := set.Parse(arguments); err != nil {
		return err
	}
	if configPath != "" {
		value, err := config.Load(configPath)
		if err != nil {
			return err
		}
		roots, depth, port, basePath = value.Roots, value.Depth, value.Port, value.BasePath
	}
	if len(roots) == 0 {
		if configured := os.Getenv("DIFF_ROOTS"); configured != "" {
			roots = strings.Split(configured, string(os.PathListSeparator))
		} else if configured := os.Getenv("DIFF_REPO"); configured != "" {
			roots = []string{configured}
		} else {
			current, _ := os.Getwd()
			roots = []string{current}
		}
	}
	if configured := os.Getenv("PORT"); configured != "" && configPath == "" {
		if parsed, err := strconv.Atoi(configured); err == nil {
			port = parsed
		}
	}
	basePath = server.NormalizeBasePath(basePath)
	address := fmt.Sprintf("%s:%d", host, port)
	handler := server.New(catalog.New(roots, depth), web.Assets(), basePath)
	httpServer := &http.Server{Addr: address, Handler: handler, ReadHeaderTimeout: 5 * time.Second}
	fmt.Printf("Pocket Diff: http://%s%s/\nSearch roots: %s\nScan depth: %d\n", address, basePath, strings.Join(roots, ", "), depth)
	return httpServer.ListenAndServe()
}

func doctor() error {
	fmt.Printf("Pocket Diff: %s (%s/%s)\n", version, runtime.GOOS, runtime.GOARCH)
	for _, command := range []string{"git", "tailscale"} {
		path, err := exec.LookPath(command)
		if err != nil {
			fmt.Printf("%s: not found\n", command)
		} else {
			fmt.Printf("%s: %s\n", command, path)
		}
	}
	configPath, err := config.DefaultPath()
	if err != nil {
		return err
	}
	if _, err := os.Stat(configPath); err == nil {
		fmt.Printf("Config: %s\n", configPath)
	} else if errors.Is(err, os.ErrNotExist) {
		fmt.Println("Config: not installed")
	} else {
		return err
	}
	return nil
}

func usage() {
	fmt.Println(`Pocket Diff

  pocket-diff setup [--root PATH] [--depth N] [--base-path /diff] [--port 4173]
  pocket-diff serve [--config PATH | --root PATH]
  pocket-diff doctor
  pocket-diff version`)
}
