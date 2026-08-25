# Diet App

体重・食事・筋トレを記録し、在庫から満腹救済食を選べる個人用Webアプリです。

GitHub Pages: https://fmokutagawa-design.github.io/diet-app/

## 公式メニューデータ

`scripts/update-menus.mjs` が公式栄養情報を取得して `external-menus.json` を更新します。GitHub Actionsで毎週月曜・木曜（JST早朝）に実行します。

- 対応済み: マクドナルド、モス、松屋（各社公式栄養情報）
- 次の対象: すき家、吉野家、コンビニ、イオン、しんぱち食堂
- 取得に失敗した場合は直前の正常データを保持
- 公式値がない栄養・価格は推定で埋めず、未取得として表示
