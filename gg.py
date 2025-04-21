import subprocess
import os
import sys
import argparse

_ASSIGNMENT_FILE = ".gg.txt"
_CONFLICT_FILE = ".gg-conflicts.txt"
_MAIN_BRANCH = "main"
_UNTRACKED_BRANCH = "UNTRACKED"
_LIST_LOCAL_BRANCHES_CMD = "git for-each-ref --format='%(refname:short)' refs/heads/"
_LIST_ALL_MODIFIED_FILES = "git ls-files --modified --others --exclude-standard"
_DIFF_FILES_IN_BRANCH = "git diff-tree -r --name-only %s %s"
_CREATE_BRANCH = "git branch %s"
_DIFF_FILES_IN_BRANCH_WRT_TO_WORKING_TREE = "git diff %s:%s -- %s"
_COMMIT = """
BRANCH_NAME="%s"

# Create temporary index
GIT_INDEX_FILE=$(mktemp)
export GIT_INDEX_FILE

# Start with the base commit's tree
base_tree=$(git rev-parse HEAD^{tree})
git read-tree $base_tree

# Add files to the temporary index
for file in %s; do
  git add "$file"
done

# Create a new tree from the current index
new_tree=$(git write-tree)

# Create a new commit
commit_message="%s

%s
"
new_commit=$(git commit-tree $new_tree -p $(git rev-parse $BRANCH_NAME) -m "$commit_message")

# Update a branch to point to the new commit
git update-ref refs/heads/$BRANCH_NAME $new_commit

# Cleanup
rm $GIT_INDEX_FILE
unset GIT_INDEX_FILE
"""


_SYNC_AND_MERGE = """
git stash push -u
git pull origin main
for f in $(git stash show --include-untracked --name-only stash@{0}) ; do
    TMPDIR=$(mktemp -d)
    git show "stash@{0}^3:$f" > $TMPDIR/$(basename $f).new
    if [[ -e "$f" ]]; then
        if [[ `git show $(git merge-base HEAD stash@{0}):$f > $TMPDIR/$(basename $f).base` ]]; then
            git merge-file $f $TMPDIR/$(basename $f).base $TMPDIR/$(basename $f).new || echo "Conflict: $f"
        else
            git merge-file $f /dev/null $TMPDIR/$(basename $f).new || echo "Conflict: $f"
        fi
    else
        cp $TMPDIR/$(basename $f).new "$f"
    fi
    rm -f $TMPDIR/$(basename $f).new $TMPDIR/$(basename $f).base
    rmdir $TMPDIR    
done
git stash drop stash@{0}
"""


def _run_or_die(cmd: str) -> list[str]:
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if result.returncode != 0:
        print("Error when running:\n%s\nStderr:\n" % cmd, file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        exit(1)
    return result.stdout.splitlines()


def _list_untracked_and_modified_files() -> list[str]:
    return _run_or_die(_LIST_ALL_MODIFIED_FILES)


def _list_branches() -> list[str]:
    return _run_or_die(_LIST_LOCAL_BRANCHES_CMD)


def _create_branch_or_die(name: str) -> None:
    _run_or_die(_CREATE_BRANCH % name)


def _load_branch_map_from_git(diff_base: str = _MAIN_BRANCH) -> dict[str, list[str]]:
    # These files are a combination of files untracked in git terms, and
    # modified files in the current worktree. But some of those files can be
    # already comitted into some of the branches.
    potentially_untracked_files = set(_list_untracked_and_modified_files())

    branch_map = {}
    for branch in _list_branches():
        if branch in (_MAIN_BRANCH, _UNTRACKED_BRANCH):
            continue

        # Get a list of files between `main` and $branch. I.e. files that are
        # committed in the given branch.
        files = _run_or_die(_DIFF_FILES_IN_BRANCH % (diff_base, branch))
        branch_map[branch] = files
        potentially_untracked_files = potentially_untracked_files.difference(files)
        
    # At this point all mapped files were already mapped, so all remaining are
    # untracked.
    branch_map[_UNTRACKED_BRANCH] = sorted(potentially_untracked_files)
    return branch_map


def _load_branch_map_from_file() -> dict[str, list[str]]:
    branch_map = {}
    with open(_ASSIGNMENT_FILE) as f_in:
        for ln in f_in.readlines():
            ln = ln.strip()
            if ln.startswith("# "):
                branch_name = ln[2:]
                branch_map[branch_name] = []
            elif ln:
                branch_map[branch_name].append(ln)

    return branch_map


def _save_branch_map(branch_map: dict[str, list[str]]) -> None:
    with open(_ASSIGNMENT_FILE, "w") as f_out:
        lines = []
        for branch, files in branch_map.items():
            lines.append("# %s" % branch)
            lines.extend(files)
            lines.append("")

        f_out.writelines([line + "\n" for line in lines])


def _commit_branch_map(
    existing_branch_map: dict[str, list[str]],
    target_branch_map: dict[str, list[str]],
    always_commit: bool = False,
    commit_message_header: str = "Update.",
) -> None:
    branches = _list_branches()
    for branch, files in target_branch_map.items():
        if branch == _UNTRACKED_BRANCH:
            continue

        if branch not in branches:
            _create_branch_or_die(branch)

        modified_files = []
        for file in files:
            result = subprocess.run(
                _DIFF_FILES_IN_BRANCH_WRT_TO_WORKING_TREE % (branch, file, file),
                shell=True,
                capture_output=True,
                text=True,
            )
            if result.returncode != 0:
                # This happens when the file doesn't exist in the given branch. This is ok.
                if "fatal: bad revision" in result.stderr:
                    modified_files.append(file)
                else:
                    print(result.stderr)
                    return 1
            else:
                if result.stdout.strip():
                    modified_files.append(file)

        if (
            not modified_files
            and existing_branch_map[branch] == files
            and not always_commit
        ):
            print(
                "Skipping %s, as there are no new files to update." % branch,
                file=sys.stderr,
            )
            continue

        print(
            "Committing [branch=%s] files=%s modified_files=%s removed_files=%s"
            % (
                branch,
                files,
                modified_files,
                sorted(set(existing_branch_map.get(branch, [])).difference(files)),
            ),
            file=sys.stderr,
        )

        cmd = _COMMIT % (
            branch,
            " ".join(files),
            commit_message_header,
            "\n".join("- %s" % f for f in files),
        )
        _run_or_die(cmd)


def _push_all() -> None:
    branches = _list_branches()
    for branch in branches:
        _run_or_die("git push origin %s" % branch)


def _pull() -> None:
    merge_base = _run_or_die("git merge-base HEAD HEAD")[0]
    conflicts = _run_or_die(_SYNC_AND_MERGE)
    new_base = _run_or_die("git merge-base HEAD HEAD")[0]
    print('%s --> %s' % (merge_base, new_base))
    if conflicts:
        with open(_CONFLICT_FILE, 'w') as f_out:
            print(merge_base, file=f_out)
            print("\n".join(conflicts), file=f_out)
    else:
        print("Merging.")
        _merge_all(merge_base)
    
def _merge_all(merge_base: str) -> None:
    # Otherwise add Merge commit to all branches.
    branch_map = _load_branch_map_from_git(diff_base=merge_base)
    _commit_branch_map(
        existing_branch_map=branch_map,
        target_branch_map=branch_map,
        always_commit=True,
        commit_message_header="Merge.",
    )

def _resolve() -> None:
    merge_base = open(_CONFLICT_FILE).readlines()[0].strip()
    os.unlink(_CONFLICT_FILE)
    _merge_all(merge_base)


def _die_if_conflict_resolution_in_progress():
    if os.path.exists(_CONFLICT_FILE):
        print('Conflict resolution in progress. Once happy, you need to run `gg resolve`')
        exit(1)


def _set_branch(file: str, target_branch: str) -> None:
    branch_map = _load_branch_map_from_file()
    for branch, files in branch_map.items():
        if file in files:
            files.remove(file)
    
    if target_branch not in branch_map:
        branch_map[target_branch] = []

    branch_map[target_branch].append(file)

    _save_branch_map(branch_map)

def main():
    parser = argparse.ArgumentParser(
        prog="gg",
        description="Manages multiple complementary PR branches within single Git repo.",
    )
    parser.add_argument("command")
    parser.add_argument("-b", "--branch", required=False)
    parser.add_argument("-f", "--file", required=False)
    args = parser.parse_args()

    match args.command:
        case "update-branch-map" | "u":
            branch_map = _load_branch_map_from_git()
            _save_branch_map(branch_map)

        case "commit-all" | "c":
            _die_if_conflict_resolution_in_progress()
            existing_branch_map = _load_branch_map_from_git()
            branch_map = _load_branch_map_from_file()
            _commit_branch_map(
                existing_branch_map=existing_branch_map, target_branch_map=branch_map
            )

        case "push-all":
            _die_if_conflict_resolution_in_progress()
            _push_all()

        case "pull":
            _die_if_conflict_resolution_in_progress()
            _pull()
        
        case "resolve":
            _resolve()
        
        case "set-branch":
            _set_branch(file=args.file, target_branch=args.branch)

        case _:
            print("Unsupported command: %s" % args.command, file=sys.stderr)
            exit(1)
    return


if __name__ == "__main__":
    main()
