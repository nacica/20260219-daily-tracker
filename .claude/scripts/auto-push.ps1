# Stop hook: Claude のターン終わりに変更を自動で add → commit → push する。
# 失敗しても exit 0 で抜けて Claude の動作はブロックしない。

$ErrorActionPreference = 'Continue'

# リポジトリのルートに移動
$repoRoot = git rev-parse --show-toplevel
if ($LASTEXITCODE -ne 0) { exit 0 }
Set-Location $repoRoot

# 現在の作業ツリーと、未 push のローカルコミットをチェック
$changes  = git status --porcelain
$unpushed = ''
try {
    $unpushed = git log 'origin/main..HEAD' --oneline 2>$null
} catch {}

# 何もなければ何もしない
if (-not $changes -and -not $unpushed) { exit 0 }

# --- 1. add & commit ---
if ($changes) {
    git add -A
    if ($LASTEXITCODE -ne 0) {
        [Console]::Error.WriteLine("[auto-push] git add に失敗しました。")
        exit 0
    }

    # ignore 済みファイルしか無かったケースに備えて stage を確認
    $staged = git diff --cached --name-only
    if ($staged) {
        $files      = ($staged | Select-Object -First 3) -join ', '
        $totalCount = ($staged | Measure-Object).Count
        $suffix     = if ($totalCount -gt 3) { " 他$($totalCount - 3)件" } else { "" }
        $timestamp  = Get-Date -Format 'yyyy-MM-dd HH:mm'
        $msg        = "chore(auto): $files$suffix ($timestamp)"

        git commit -m $msg
        if ($LASTEXITCODE -ne 0) {
            [Console]::Error.WriteLine("[auto-push] commit に失敗しました。手動で確認してください。")
            exit 0
        }
        [Console]::Error.WriteLine("[auto-push] commit: $msg")
    }
}

# --- 2. push ---
git push origin main
if ($LASTEXITCODE -ne 0) {
    [Console]::Error.WriteLine("[auto-push] push に失敗しました。`git pull origin main --rebase` してから手動で `git push origin main` してください。")
    exit 0
}

[Console]::Error.WriteLine("[auto-push] origin/main に push 完了")
exit 0
