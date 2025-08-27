# DailyCheck

手書きCSV/TXTまたは本アプリが出力したCSVを読み込み、日次チェックリストとして表示・更新・書き出しできます。

## 使い方

1. `index.html` をブラウザで開く
2. 対象日を選択
3. 右側のファイル選択で CSV/TXT を読み込む
   - **A) 手書き形式**：`時刻, 要件, URL`（ヘッダー無し／カンマ・タブ可／`#`行はコメント）
   - **B) アプリ形式**：ヘッダー `checked,planned_time,completed_at,task,url`
4. チェックを入れると、その瞬間の **完了時刻** を記録
5. 「共有」→「ファイルに保存」で **`DailyCheck‗yymmdd.csv`** をダウンロード

## 出力CSV列

- `checked` … 1/0
- `planned_time` … `HH:MM`
- `completed_at` … ISO 8601（例：`2025-08-27T16:42:10+09:00`）
- `task` … 要件
- `url` … リンク
