set -ex

cd "$(dirname "$0")"
GG="$(realpath gg.py)"

cd /tmp/
rm -rf /tmp/lukaszilka_x
rm -rf /tmp/lukaszilka_x_upstream

mkdir /tmp/lukaszilka_x
cd /tmp/lukaszilka_x
git init -b main
touch main.py
git add main.py
git commit -am "Main."
git checkout -b branch1
touch file1
git add file1
git commit -am "Init."
git checkout main
git checkout -b branch2
touch file2
git add file2
git commit -am "Init."
git checkout main
git restore --source=branch1 .
git restore --source=branch2 .
touch file3
git status

echo
echo
git log -b branch1
git log -b branch2
echo
echo

# Make sure the branch map is as expected.
python3 $GG update-branch-map 
diff .gg.txt /dev/stdin <<EOS
# branch1
file1

# branch2
file2

# UNTRACKED
file3

EOS
echo "-------------------------------------------------------------------------"
echo "Hey2!" > file2
python3 $GG commit-all
diff <(git log --format=%B -n 1 -b branch1 --) /dev/stdin <<EOS
Init.

EOS
diff <(git log --format=%B -n 1 -b branch2 --) /dev/stdin <<EOS
Update.

- file2

EOS


echo "-------------------------------------------------------------------------"
cat > .gg.txt <<EOS
# branch1
file1

# branch2
file2

# branch3
file3
EOS

python3 $GG commit-all
diff <(git log --format=%B -n 1 -b branch3 --) /dev/stdin <<EOS
Update.

- file3

EOS


echo "-------------------------------------------------------------------------"
cat > .gg.txt <<EOS
# branch1
file1
file2
file3

# branch2

# branch3
EOS
python3 $GG commit-all
diff <(git log --format=%B -n 1 -b branch1 --) /dev/stdin <<EOS
Update.

- file1
- file2
- file3

EOS
diff <(git log --format=%B -n 1 -b branch2 --) /dev/stdin <<EOS
Update.



EOS
diff <(git log --format=%B -n 1 -b branch3 --) /dev/stdin <<EOS
Update.



EOS

echo "-------------------------------------------------------------------------"
cat > .gg.txt <<EOS
# branch1

# branch2

# branch3

# UNTRACKED
file1
file2
file3
EOS
python3 $GG commit-all
diff <(git log --format=%B -n 1 -b branch1 --) /dev/stdin <<EOS
Update.



EOS
diff <(git log --format=%B -n 1 -b branch2 --) /dev/stdin <<EOS
Update.



EOS
diff <(git log --format=%B -n 1 -b branch3 --) /dev/stdin <<EOS
Update.



EOS

echo "-------------------------------------------------------------------------"
python3 $GG set-branch -b branch1 -f file1
diff .gg.txt /dev/stdin <<EOS
# branch1
file1

# branch2

# branch3

# UNTRACKED
file2
file3

EOS
echo "-------------------------------------------------------------------------"
python3 $GG commit-all

cp -r /tmp/lukaszilka_x /tmp/lukaszilka_x_upstream
echo "Some change" > file1
python3 $GG commit-all

cd /tmp/lukaszilka_x_upstream
echo "file4 content" > file4
echo "UPSTREAM" > file1
git add file1 file4
git status
git commit -am "Upstream change."

cd /tmp/lukaszilka_x
git remote add origin /tmp/lukaszilka_x_upstream

python3 $GG pull
python3 $GG pull || true
echo "Resolved UPSTREAM vs Some change" > file1
python3 $GG resolve

python3 $GG push-all
