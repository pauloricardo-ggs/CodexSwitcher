interface UriLike {
  scheme: string;
  fsPath: string;
  toString(skipEncoding?: boolean): string;
}

interface WorkspaceFileLike extends UriLike {}

interface WorkspaceFolderLike {
  uri: UriLike;
}

export function buildLaunchArguments(
  workspaceFile: WorkspaceFileLike | undefined,
  workspaceFolders: readonly WorkspaceFolderLike[] | undefined,
): string[] {
  const args = ["--new-window"];

  if (workspaceFile) {
    if (workspaceFile.scheme === "file") {
      args.push(workspaceFile.fsPath);
    } else {
      args.push("--file-uri", workspaceFile.toString(true));
    }
    return args;
  }

  const firstFolder = workspaceFolders?.[0]?.uri;
  if (!firstFolder) {
    return args;
  }

  if (firstFolder.scheme === "file") {
    args.push(firstFolder.fsPath);
  } else {
    args.push("--folder-uri", firstFolder.toString(true));
  }

  return args;
}
