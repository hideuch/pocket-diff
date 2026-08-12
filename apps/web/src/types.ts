export type Repository = {
  id: string;
  name: string;
  label: string;
  branch: string;
  changes: number;
};

export type DiffResponse = {
  repo: string;
  branch: string;
  base: string;
  patch: string;
  revision: string;
  statusRevision: string;
  changeToken: string;
  summary: { additions: number; deletions: number; files: number };
  filesStatus: GitFileStatus[];
  skipped: string[];
  generatedAt: string;
};

export type GitStageState = "unstaged" | "partial" | "staged";

export type GitFileStatus = {
  path: string;
  previousPath?: string;
  stage: GitStageState;
  kind: "modified" | "added" | "deleted" | "renamed" | "untracked";
};

export type GitMutationAction = "stage" | "stage-all" | "unstage" | "unstage-all" | "discard" | "commit";

export type GitStatusResponse = {
  filesStatus: GitFileStatus[];
  statusRevision: string;
  changeToken: string;
};

export type ApiError = {
  error?: string;
  detail?: string;
};

export type FileResponse = {
  content: string;
  path: string;
  source: "working" | "head";
  size: number;
};
