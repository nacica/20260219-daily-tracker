"""
MCP 連携（claude.ai カスタムコネクタ）のログインパスワードから bcrypt ハッシュを作る。

使い方:
  cd backend
  python scripts/make_password_hash.py            # 対話入力（表示されない）
  python scripts/make_password_hash.py "パスワード"  # 引数で指定（シェル履歴に残るので注意）

出力されたハッシュを環境変数 MCP_OWNER_PASSWORD_HASH に設定する。
本番（Cloud Run）は GitHub Secrets 経由:
  gh secret set MCP_OWNER_PASSWORD_HASH --body '<ハッシュ>'
  gh secret set MCP_TOKEN_SECRET --body "$(python -c 'import secrets;print(secrets.token_urlsafe(48))')"
"""

import getpass
import secrets
import sys

import bcrypt


def main() -> None:
    if len(sys.argv) > 1:
        password = sys.argv[1]
    else:
        password = getpass.getpass("パスワード: ")
        again = getpass.getpass("もう一度: ")
        if password != again:
            print("一致しません", file=sys.stderr)
            sys.exit(1)
    if len(password) < 12:
        print("12 文字以上にしてください", file=sys.stderr)
        sys.exit(1)
    h = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("ascii")
    print("MCP_OWNER_PASSWORD_HASH=" + h)
    print("MCP_TOKEN_SECRET（新規生成の例）=" + secrets.token_urlsafe(48))


if __name__ == "__main__":
    main()
