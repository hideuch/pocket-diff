package catalog

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const cacheDuration = 10 * time.Second

var skippedDirectories = map[string]bool{
	".git": true, ".cache": true, ".next": true, ".turbo": true, ".venv": true,
	"build": true, "coverage": true, "dist": true, "Library": true, "node_modules": true,
	"Pods": true, "target": true, "vendor": true,
}

type Repository struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Label   string `json:"label"`
	Branch  string `json:"branch"`
	Changes int    `json:"changes"`
	Path    string `json:"-"`
}

type Catalog struct {
	roots     []string
	maxDepth  int
	mu        sync.Mutex
	items     []Repository
	lastScan  time.Time
	cacheTime time.Duration
}

func New(roots []string, maxDepth int) *Catalog {
	return &Catalog{roots: roots, maxDepth: max(0, min(maxDepth, 8)), cacheTime: cacheDuration}
}

func (c *Catalog) Scan(force bool) []Repository {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !force && time.Since(c.lastScan) < c.cacheTime {
		return clone(c.items)
	}

	type discovered struct{ path, root string }
	unique := map[string]discovered{}
	for _, configuredRoot := range c.roots {
		root, err := filepath.EvalSymlinks(configuredRoot)
		if err != nil {
			continue
		}
		info, err := os.Stat(root)
		if err != nil || !info.IsDir() {
			continue
		}
		for _, repositoryPath := range walk(root, c.maxDepth) {
			canonical, err := filepath.EvalSymlinks(repositoryPath)
			if err == nil {
				unique[canonical] = discovered{canonical, root}
			}
		}
	}

	items := make([]Repository, 0, len(unique))
	for _, item := range unique {
		if repository, ok := describe(item.path, item.root); ok {
			items = append(items, repository)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		iDirty, jDirty := items[i].Changes > 0, items[j].Changes > 0
		if iDirty != jDirty {
			return iDirty
		}
		return items[i].Label < items[j].Label
	})
	c.items, c.lastScan = items, time.Now()
	return clone(items)
}

func (c *Catalog) Resolve(id string) (string, bool) {
	for _, force := range []bool{false, true} {
		for _, repository := range c.Scan(force) {
			if repository.ID == id {
				return repository.Path, true
			}
		}
	}
	return "", false
}

func clone(items []Repository) []Repository {
	return append([]Repository(nil), items...)
}

func walk(root string, maxDepth int) []string {
	var repositories []string
	var visit func(string, int)
	visit = func(directory string, depth int) {
		if _, err := os.Stat(filepath.Join(directory, ".git")); err == nil {
			repositories = append(repositories, directory)
		}
		if depth >= maxDepth {
			return
		}
		entries, err := os.ReadDir(directory)
		if err != nil {
			return
		}
		for _, entry := range entries {
			if !entry.IsDir() || entry.Type()&os.ModeSymlink != 0 || skippedDirectories[entry.Name()] {
				continue
			}
			visit(filepath.Join(directory, entry.Name()), depth+1)
		}
	}
	visit(root, 0)
	return repositories
}

func describe(repositoryPath, scanRoot string) (Repository, bool) {
	branch, err := git(repositoryPath, "branch", "--show-current")
	if err != nil {
		return Repository{}, false
	}
	status, err := git(repositoryPath, "status", "--porcelain=v1", "-z", "--untracked-files=all")
	if err != nil {
		return Repository{}, false
	}
	relative, _ := filepath.Rel(scanRoot, repositoryPath)
	label := filepath.ToSlash(relative)
	if label == "." || label == "" {
		label = filepath.Base(repositoryPath)
	}
	hash := sha256.Sum256([]byte(repositoryPath))
	name := strings.TrimSpace(branch)
	if name == "" {
		name = "detached HEAD"
	}
	return Repository{ID: hex.EncodeToString(hash[:])[:16], Name: filepath.Base(repositoryPath), Label: label, Branch: name, Changes: CountStatusEntries(status), Path: repositoryPath}, true
}

func git(directory string, args ...string) (string, error) {
	command := exec.Command("git", args...)
	command.Dir = directory
	output, err := command.Output()
	return string(output), err
}

func CountStatusEntries(porcelain string) int {
	entries := strings.Split(porcelain, "\x00")
	count := 0
	for index := 0; index < len(entries); index++ {
		if entries[index] == "" {
			continue
		}
		status := entries[index]
		if len(status) > 2 {
			status = status[:2]
		}
		count++
		if strings.ContainsAny(status, "RC") {
			index++
		}
	}
	return count
}
