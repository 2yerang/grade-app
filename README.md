# 성적 관리 웹앱

한양대 서울캠퍼스 학사 규정(4.5 만점)으로 학기 평점·누적 평점·백분위 환산점수·이수 학점을 계산하는 개인용 웹앱입니다.
재수강·학점포기를 규정대로 반영하고, 시뮬레이션 탭에서 다음 학기 계획·재수강·학점포기 결과를 미리 비교합니다.

- 서버 없음: 성적은 이 기기의 브라우저(localStorage)에만 저장됩니다.
- 빌드 없음: 정적 파일 그대로 GitHub Pages에 올리면 동작합니다 (PWA, 오프라인 실행).
- 아이패드 가로/세로, Split View, PC, 라이트/다크 모드 지원.

## GitHub Pages로 배포

1. GitHub에서 새 저장소를 만듭니다 (예: `grade-app`). 성적 데이터는 저장소에 올라가지 않으므로 공개 저장소여도 됩니다.
2. 이 폴더에서:
   ```bash
   git add .
   git commit -m "성적 관리 웹앱"
   git branch -M main
   git remote add origin https://github.com/<아이디>/grade-app.git
   git push -u origin main
   ```
3. 저장소 **Settings › Pages** › Source: `Deploy from a branch`, Branch: `main` / `(root)` › Save.
4. 1~2분 뒤 `https://<아이디>.github.io/grade-app/` 에서 열립니다.

## 아이패드에서 쓰기

1. Safari로 위 주소를 엽니다.
2. 공유 버튼 › **홈 화면에 추가**. 이후에는 홈 화면 아이콘으로만 여세요.
   - Safari는 오래 방문하지 않은 사이트의 데이터를 지울 수 있는데, 홈 화면 앱은 이 대상에서 빠집니다.
   - Safari 탭과 홈 화면 앱은 저장소가 따로일 수 있으니 한쪽에서만 쓰세요.
3. 설정 › **JSON 내보내기**로 주기적으로 백업하세요 (파일 앱/iCloud Drive에 저장). 30일이 지나면 대시보드에 백업 권유가 뜹니다.

## 업데이트 배포

파일을 고친 뒤 `sw.js`의 `VERSION`을 올리고 push 하세요. 앱을 다시 열면 새 버전이 적용됩니다.

## 구조

```
index.html              진입점
css/app.css             디자인 토큰(A안 · 조용한 성적부), 라이트/다크, 반응형
js/domain/              화면과 무관한 계산 로직
  grades.js             등급표, 이수구분·수업 유형 기본값, 설정 기본값
  calc.js               평점·백분위·이수 학점, 재수강 묶음, 학기 평점(재수강 옵션)
  rules.js              재수강·학점포기 가능 여부, 후보 목록, 계획 반영
  registration.js       수강신청 조건 검사 (e-러닝 C형, 계절학기 한도 등)
  advisor.js            학점포기 추천(조합 탐색), 목표 평점 역산
js/store.js             저장(localStorage), 가져오기 검증·합치기, 내보내기
js/ui/                  화면(views), 과목 입력 시트(sheet), 확인 창(dialogs)
js/app.js               이벤트 처리
sw.js                   오프라인 캐시
tests/calc.test.js      계산 로직 테스트
```

## 테스트

Node.js 18 이상에서:

```bash
npm test
```

## 남은 확인 사항 (PRD 13장)

- 백분위 공식(`55 + 평점 × 10`)을 성적증명서와 대조 → 다르면 설정 › 백분위 공식에서 수정
- 정규학기 최대 신청 학점 → 설정 › 수강신청 규칙에 입력
- 입학년도 → 설정에 입력 (재수강 횟수 규칙 적용 여부)
- 재수강 후 이전 학기 평점 표시 방식 → 포털 확인 후 설정에서 선택
