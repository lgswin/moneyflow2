# 머니플로우

원화·달러 계좌의 입금, 송금, 지출을 기록하는 간단한 돈 관리 앱입니다. 서버 없이 브라우저에서만 동작하며, 데이터는 이 기기의 `localStorage`에 저장됩니다.

## 기능

- 계좌 생성 / 편집 / 삭제 (이름, 원화 또는 달러)
- 입금: 금액, 사유
- 송금: 상대 계좌, 금액. 통화가 다르면 `1 USD = ? KRW` 환율로 환전
- 지출: 금액, 사유
- 계좌별 거래 내역

## 로컬에서 보기

저장소 폴더에서 정적 서버를 띄우면 됩니다.

```bash
python3 -m http.server 8080
```

브라우저에서 `http://localhost:8080`을 엽니다.

## GitHub Pages

이 저장소는 GitHub Pages용 정적 사이트입니다.

1. GitHub 저장소 **Settings → Pages**
2. **Source**를 **GitHub Actions**로 선택
3. `main` 브랜치에 푸시하면 `.github/workflows/pages.yml`이 배포합니다

주소는 보통 다음과 같습니다.

`https://<사용자이름>.github.io/moneyflow2/`
