/* 한국어 안내 문구 (초안, 작가가 다시 쓸 예정). 키와 자리표시자는 copy-en.ts와 같아야 한다. */
import type { GuideKey } from "./copy-en";

export const guideKo: Record<GuideKey, string> = {
  // ── 공통 ──
  "guide.toc.title": "이 페이지에서",
  "guide.nav.label": "다른 안내",
  "guide.nav.prev": "이전",
  "guide.nav.next": "다음",
  "guide.yes": "예",
  "guide.no": "아니요",
  "guide.loading": "페이지를 불러오는 중…",

  // ── 이렇게 써요 ──
  "guide.how.title": "이렇게 써요",
  "guide.how.lead":
    "공유를 만들고, 들어오는 방법을 알리고, 같이 고쳐요. 각 단계와 소유자가 쓸 수 있는 설정을 차례로 설명해요.",
  "guide.how.toc.create": "공유 만들기",
  "guide.how.toc.tell": "들어오는 방법 알리기",
  "guide.how.toc.edit": "같이 고치기",
  "guide.how.toc.files": "파일 넣는 방법",
  "guide.how.toc.roles": "소유자, 편집자, 보기 전용",
  "guide.how.toc.control": "누가 들어올지 정하기",
  "guide.how.toc.offline": "연결이 끊겼을 때",

  "guide.how.create.title": "공유 만들기",
  "guide.how.create.body1":
    "첫 화면에서 새 공유를 만들거나 템플릿으로 시작해요. 기본 설정에서는 가입이나 로그인이 필요 없고, 만든 사람이 그 공유의 소유자가 돼요. 관리자가 게스트를 막았다면 먼저 로그인해야 해요.",
  "guide.how.create.body2":
    "공유마다 영문자와 숫자 8자로 된 주소와 숫자 6자리 참여 코드가 생겨요. 둘 다 같은 공유를 열어요.",
  "guide.how.create.templatesLink": "템플릿 알아보기",

  "guide.how.tell.title": "들어오는 방법 알리기",
  "guide.how.tell.lead": "방법은 다섯 가지예요. 지금 있는 곳에서 가장 빠른 걸 쓰세요.",
  "guide.how.tell.code.title": "참여 코드",
  "guide.how.tell.code.body":
    "숫자 6개를 알려 주세요. 첫 화면에 입력하거나 /482913처럼 주소 뒤에 붙이면 돼요.",
  "guide.how.tell.qr.title": "QR 코드",
  "guide.how.tell.qr.body":
    "공유 창을 열고 휴대폰 카메라로 코드를 비추세요. 휴대폰이 같은 네트워크에 있어야 해요. 전체 화면으로 보기를 누르면 프로젝터에 큰 코드와 QR 코드를 띄울 수 있어요.",
  "guide.how.tell.nearby.title": "근처 공유",
  "guide.how.tell.nearby.body":
    "같은 네트워크에서 열려 있는 공유가 첫 화면에 보여요. 하나를 골라 들어가면 돼요. PIN이나 입장 승인을 켠 공유는 목록에 나오지 않고, 소유자는 어떤 공유든 숨길 수 있어요.",
  "guide.how.tell.send.title": "사람에게 보내기",
  "guide.how.tell.send.body":
    "공유 창에서 이름을 검색해 보내요. 상대 화면에 초대가 뜨고, 메모를 쓰면 최대 200자까지 함께 가요. gachipad를 연 사람만 목록에 나와요.",
  "guide.how.tell.room.title": "방 전체에 띄우기",
  "guide.how.tell.room.body":
    "버튼 한 번으로 같은 방 사람들에게 공유를 띄워요. 방을 따로 설정하지 않았다면 같은 네트워크 전체예요. 먼저 확인을 거치고, 각자 화면에 알림이 떠서 버튼으로 열어요.",
  "guide.how.tell.shortcut": "공유 창은 상단 바에 있어요. 단축키는",
  "guide.how.tell.networkLink": "같은 네트워크에서 더 빠른 이유",

  "guide.how.edit.title": "같이 고치기",
  "guide.how.edit.lead":
    "모두가 같은 파일에 동시에 입력해요. 변경 내용이 합쳐지므로 같은 줄을 함께 고쳐도 서로 덮어쓰지 않아요.",
  "guide.how.edit.cursors.title": "이름이 붙은 커서",
  "guide.how.edit.cursors.body":
    "사람마다 색깔 있는 커서와 이름표가 있어서 누가 어디를 고치는지 볼 수 있어요. 사람이 많아 어수선하면 설정의 다른 사람 커서에서 보이는 방식을 바꿀 수 있어요.",
  "guide.how.edit.follow.title": "따라가기",
  "guide.how.edit.follow.body":
    "상단 바에서 사람을 고르고 따라가기를 누르세요. 멈출 때까지 그 사람의 화면 위치를 따라가요.",
  "guide.how.edit.files.title": "여러 파일",
  "guide.how.edit.files.body":
    "공유 하나에 파일과 폴더를 여러 개 둘 수 있어요. 파일 이름에 따라 언어가 정해지고, 소유자가 허용하면 참여자도 바꿀 수 있어요.",
  "guide.how.edit.comments.title": "코멘트",
  "guide.how.edit.comments.body":
    "줄이나 선택 영역에 코멘트를 달 수 있어요. 주변 글이 바뀌어도 그 코드에 붙어 있고, 해결됨으로 표시할 수 있어요.",
  "guide.how.edit.lock.title": "편집 잠금",
  "guide.how.edit.lock.body":
    "소유자는 편집을 잠가서 자기만 코드를 고치게 할 수 있어요. 설명하는 동안 쓰기 좋아요.",

  "guide.how.files.title": "파일 넣는 방법",
  "guide.how.files.lead":
    "내 컴퓨터의 파일을 공유에 넣는 방법은 네 가지예요. 소유자는 언제나 쓸 수 있고, 편집자는 소유자가 공유 창에서 참여자의 파일 추가를 허용했을 때 쓸 수 있어요.",
  "guide.how.files.drag.title": "화면에 끌어다 놓기",
  "guide.how.files.drag.body":
    "파일, 폴더, .zip을 공유 화면 어디에나 끌어다 놓으세요. 화면 전체에 안내가 뜨고, 놓으면 바로 추가돼요. 첫 화면에 놓으면 그 파일로 새 공유가 만들어져요.",
  "guide.how.files.button.title": "올리기 버튼",
  "guide.how.files.button.body":
    "휴대폰처럼 끌어다 놓기 어려운 기기에서는 더 보기 메뉴의 파일 올리기를 쓰세요. 파일이나 폴더를 골라 올릴 수 있어요.",
  "guide.how.files.paste.title": "복사해서 붙여넣기",
  "guide.how.files.paste.body":
    "파일 탐색기나 Finder에서 복사한 파일은 편집기에 붙여넣어도 추가돼요.",
  "guide.how.files.zip.title": ".zip과 폴더",
  "guide.how.files.zip.body":
    ".zip은 풀어서 폴더 구조 그대로 넣고, 폴더는 안의 파일을 모두 넣어요. .git, node_modules, __pycache__ 같은 폴더는 가져오지 않아요.",
  "guide.how.files.duplicate.title": "같은 이름의 파일이 있으면",
  "guide.how.files.duplicate.body":
    "이름도 내용도 같으면 새로 만들지 않고 있는 파일을 열어 줘요. 이름은 같은데 내용이 다르면 main (2).py처럼 번호를 붙여 따로 추가하고, 있던 파일은 건드리지 않아요.",
  "guide.how.files.skipped.title": "건너뛰는 파일",
  "guide.how.files.skipped.body":
    "텍스트가 아닌 파일, {perFile}MB를 넘는 파일, 한 번에 {max}개를 넘는 파일, 공유의 크기 제한({doc}MB)을 넘는 파일, 읽을 수 없는 파일은 건너뛰어요. 어떤 파일이 왜 빠졌는지는 알림에 이름과 함께 나와요.",
  "guide.how.files.viewer":
    "보기 전용으로 들어온 사람은 파일을 추가할 수 없고, 파일을 놓으면 왜 안 되는지 알려 줘요.",

  "guide.how.roles.title": "소유자, 편집자, 보기 전용",
  "guide.how.roles.lead": "공유에 들어온 사람은 세 가지 역할 중 하나를 가져요.",
  "guide.how.roles.owner.title": "소유자",
  "guide.how.roles.owner.body":
    "공유를 만든 사람이에요. 입장과 편집 권한을 정하고, 이력을 열고, 사람을 내보내고, 편집을 잠글 수 있어요.",
  "guide.how.roles.edit.title": "편집 가능",
  "guide.how.roles.edit.body": "코드를 고칠 수 있어요. 접근 설정을 바꾸거나 이력을 열 수는 없어요.",
  "guide.how.roles.view.title": "보기 전용",
  "guide.how.roles.view.body": "코드를 읽을 수만 있고 고칠 수는 없어요.",
  "guide.how.roles.default":
    "새로 들어온 사람은 소유자가 기본값으로 정한 역할, 즉 편집 가능이나 보기 전용을 가져요.",
  "guide.how.roles.table.caption": "역할별로 할 수 있는 일",
  "guide.how.roles.table.action": "할 수 있는 일",
  "guide.how.roles.table.edit": "코드 고치기",
  "guide.how.roles.table.history": "이력 열기",
  "guide.how.roles.table.access": "접근 설정 바꾸기",
  "guide.how.roles.table.remove": "사람 내보내기와 차단",
  "guide.how.roles.table.lock": "편집 잠그기",
  "guide.how.roles.table.note": "편집이 잠겨 있는 동안에는 소유자만 코드를 고칠 수 있어요.",

  "guide.how.control.title": "누가 들어올지 정하기",
  "guide.how.control.lead":
    "소유자가 공유 창에서 정해요. 여러 개를 함께 쓸 수 있고, 바로 적용돼요.",
  "guide.how.control.mock": "공유 창의 접근 설정",
  "guide.how.control.view.title": "보기 전용 링크와 편집 링크",
  "guide.how.control.view.body":
    "기본값을 보기 전용으로 두면 들어온 사람은 읽기만 해요. 고쳐야 하는 사람에게는 따로 복사한 편집 링크를 주세요. 편집 링크는 #key= 뒤에 키가 붙는 모양이에요. 브라우저는 그 부분을 페이지 요청에 실어 보내지 않아서 서버 로그와 주소에 남지 않고, gachipad는 서버가 확인할 수 있도록 참여 요청 본문에 한 번 실어 보내요. 링크를 열면 주소창에서 키가 지워지고, 서버가 그 브라우저의 편집 권한을 기억해요.",
  "guide.how.control.pin.title": "PIN 잠금",
  "guide.how.control.pin.body":
    "{min}~{max}자의 PIN으로 공유를 잠그고, PIN은 링크와 따로 알려 주세요. {attempts}번 틀리면 그 사람은 {minutes}분 동안 기다려야 해요. 새 PIN을 정하면 모두 다시 입력해야 해요.",
  "guide.how.control.approval.title": "입장 전 승인",
  "guide.how.control.approval.body":
    "새로 온 사람은 내가 들여보낼 때까지 대기 화면에 머물러요. 거절해도 다시 요청할 수 있어요.",
  "guide.how.control.nearby.title": "근처 공유에서 숨기기",
  "guide.how.control.nearby.body":
    "근처 공유에 표시를 끄면 첫 화면 목록에 나오지 않아요. PIN이나 입장 승인을 켠 공유는 항상 목록에서 빠져요.",
  "guide.how.control.remove.title": "내보내기와 차단",
  "guide.how.control.remove.body":
    "참여 중인 사람 목록에서 내보내면 코드나 링크로 다시 들어올 수 있어요. 내보내고 차단하면 그 공유에는 다시 들어올 수 없어요.",

  "guide.how.offline.title": "연결이 끊겼을 때",
  "guide.how.offline.body1":
    "연결이 끊기면 오프라인이라는 알림이 나와요. 계속 입력하세요. 변경 내용은 보관되고, 연결이 돌아오면 다른 사람의 변경과 합쳐져요.",
  "guide.how.offline.body2":
    "탭을 닫아도 변경이 남는지는 오프라인 사본에 달려 있어요. 편집기를 처음 열 때 gachipad가 그 기기에 오프라인 사본을 저장해도 되는지 물어요. 저장하지 않기로 하면 서버에 닿지 못한 변경은 열려 있는 탭에만 있고, 알림에도 그렇게 나와요.",
  "guide.how.offline.body3":
    "자리를 비운 사이 소유자가 내보냈거나 공유가 PIN이나 승인을 다시 요구하면 다시 입장해야 하고, 보내지 못한 변경은 남지 않아요.",

  // ── 기능 ──
  "guide.features.title": "기능",
  "guide.features.lead":
    "공유 안에서 gachipad가 해 주는 일이에요. 코드를 나누는 데 필요한 기능만 담았어요.",
  "guide.features.toc.languages": "문법 강조",
  "guide.features.toc.merge": "충돌 없는 편집",
  "guide.features.toc.files": "파일과 폴더",
  "guide.features.toc.history": "이력과 복원",
  "guide.features.toc.download": "다운로드",
  "guide.features.toc.shortcuts": "단축키",
  "guide.features.toc.settings": "편집기 설정",
  "guide.features.toc.cursors": "다른 사람 커서",
  "guide.features.toc.lab": "실습실 모드",
  "guide.features.toc.templates": "템플릿",
  "guide.features.toc.more": "그 밖의 기능",

  "guide.features.languages.title": "문법 강조",
  "guide.features.languages.body1":
    "200개가 넘는 언어를 각자의 문법과 색으로 보여줘요. 언어는 파일 이름으로 정하거나 글에서 알아내고, 상태 표시줄에서 바꿀 수 있어요. 바꾸면 공유한 모두에게 적용돼요.",
  "guide.features.languages.body2":
    "모든 토큰 색은 어두운 테마와 밝은 테마 모두에서 편집기 배경과의 대비가 4.5:1 이상이에요.",
  "guide.features.languages.searchLabel": "언어 검색",
  "guide.features.languages.placeholder": "이름, 별칭, 파일 확장자",
  "guide.features.languages.shown": "{total}개 중 {shown}개 표시",
  "guide.features.languages.empty": "“{query}”에 맞는 언어가 없어요",
  "guide.features.languages.loading": "목록을 불러오는 중…",
  "guide.features.languages.error": "목록을 불러오지 못했어요",
  "guide.features.languages.listLabel": "지원하는 언어",

  "guide.features.merge.title": "충돌 없는 편집",
  "guide.features.merge.body1":
    "gachipad는 충돌 없는 복제 데이터를 다루는 라이브러리인 Yjs를 써요. 어느 기기에서든 동시에 한 편집은 모두에게 같은 결과로 합쳐져요. 누가 누구를 덮어쓰지 않고, 충돌을 직접 풀 필요도 없어요.",
  "guide.features.merge.body2":
    "실행 취소는 내가 한 변경만 되돌리고, 다른 사람이 입력한 내용은 건드리지 않아요.",

  "guide.features.files.title": "파일과 폴더",
  "guide.features.files.body1":
    "공유 하나에 파일을 최대 {max}개까지 둘 수 있어요. src/index.ts처럼 파일 이름에 슬래시를 넣으면 폴더가 돼요.",
  "guide.features.files.body2":
    "파일, 폴더, .zip을 화면 어디에나 끌어다 놓거나 더 보기 메뉴의 파일 올리기로 추가해요. .DS_Store, Thumbs.db, __MACOSX 같은 운영체제 부산물은 건너뛰고, Windows 경로와 줄바꿈은 알아서 정리해요.",
  "guide.features.files.more": "넣는 방법과 건너뛰는 파일 자세히 보기",
  "guide.features.files.body3":
    "크기 제한은 관리자가 정해요. 기본값은 업로드 한 번에 {upload}MB, 공유 하나의 글에 {doc}MB예요.",

  "guide.features.history.title": "이력과 복원",
  "guide.features.history.body1":
    "소유자는 상단 바에서 이력을 열 수 있어요. 다른 사람은 열 수 없고, 이력에 있는 지운 내용도 다른 사람에게 전달되지 않아요.",
  "guide.features.history.body2":
    "편집하는 동안 약 {seconds}초마다 버전을 저장하고, 공유마다 최대 {max}개까지 남겨요. 보관 기간은 관리자가 정하고 기본값은 {days}일이에요.",
  "guide.features.history.body3":
    "이력을 1배속, 2배속, 4배속으로 재생하거나 어느 버전이든 현재와 비교할 수 있어요.",
  "guide.features.history.body4":
    "버전을 복원하면 그 버전이 모두에게 현재 내용이 돼요. 복원도 일반 변경으로 추가되어 이력이 그대로 남으니, 나중에 다른 버전을 복원할 수 있어요.",

  "guide.features.download.title": "다운로드",
  "guide.features.download.body":
    "파일 하나는 언어에 맞는 확장자로, 공유 전체는 폴더 구조를 유지한 .zip으로 받을 수 있어요.",

  "guide.features.shortcuts.title": "단축키",
  "guide.features.shortcuts.lead":
    "지금 쓰는 기기에 맞춰 보여줘요. 플랫폼을 바꾸면 다른 키를 볼 수 있어요.",
  "guide.features.shortcuts.platform": "키 표시 기준",
  "guide.features.shortcuts.mac": "Mac",
  "guide.features.shortcuts.windows": "Windows, Linux",
  "guide.features.shortcuts.caption": "단축키",
  "guide.features.shortcuts.action": "동작",
  "guide.features.shortcuts.keys": "키",
  "guide.features.shortcuts.group.general": "앱",
  "guide.features.shortcuts.group.editing": "편집",
  "guide.features.shortcuts.group.navigation": "이동",
  "guide.features.shortcuts.note1":
    "입력 칸 밖에서 ?를 누르면 gachipad 안에서 이 목록을 볼 수 있어요.",
  "guide.features.shortcuts.note2":
    "Mac에서는 Command와 Option 조합을 브라우저와 macOS가 쓰기 때문에 앱 단축키에 Control과 Command를 써요. Windows와 Linux에서는 Ctrl과 Alt를 써요.",
  "guide.features.shortcuts.note3":
    "입력기로 글자를 조합하는 중에는 단축키와 Enter, Esc, Tab이 글자가 확정된 뒤에 동작해요.",

  "guide.features.settings.title": "편집기 설정",
  "guide.features.settings.lead":
    "설정은 기기마다 이 브라우저에 저장돼요. 상단 바에서 열거나 다음 키를 누르세요.",
  "guide.features.settings.theme.title": "앱 테마",
  "guide.features.settings.theme.body":
    "시스템 따라가기, 라이트, 다크 중에서 골라요. 첫 화면과 이 안내도 같이 바뀌어요.",
  "guide.features.settings.editorTheme.title": "편집기 테마",
  "guide.features.settings.editorTheme.body":
    "Slate와 Graphite는 어둡고, Paper와 Sand는 밝아요. 기본값은 앱 테마를 따라가서 다크에서는 Slate, 라이트에서는 Paper예요.",
  "guide.features.settings.font.title": "글꼴 크기",
  "guide.features.settings.font.body": "{min}px부터 {max}px까지예요. 기본값은 {default}px예요.",
  "guide.features.settings.indent.title": "들여쓰기와 줄 바꿈",
  "guide.features.settings.indent.body":
    "탭 크기(2, 3, 4, 8), 들여쓰기에 공백이나 탭 문자 쓰기, 긴 줄 바꿈, 줄 번호 표시를 각각 켜고 끌 수 있어요.",
  "guide.features.settings.keymap.title": "키맵",
  "guide.features.settings.keymap.body": "기본, Vim, Emacs, Sublime 중에서 골라요.",
  "guide.features.settings.smooth.title": "부드러운 입력",
  "guide.features.settings.smooth.body":
    "입력할 때 커서가 미끄러지듯 움직여요. 기본값은 켜짐이고, 시스템에서 동작 줄이기를 켜 두면 움직이지 않아요.",
  "guide.features.settings.notify.title": "초대 알림",
  "guide.features.settings.notify.body":
    "gachipad가 백그라운드 탭에 있을 때 초대를 시스템 알림으로 보여줘요. 기본값은 꺼짐이고, 브라우저의 허용이 필요해요.",
  "guide.features.settings.language.title": "화면 언어",
  "guide.features.settings.language.body":
    "한국어와 English 중에서 골라요. 어느 페이지에서든 바꿀 수 있고, 선택은 이 브라우저에 남아요.",

  "guide.features.cursors.title": "다른 사람 커서",
  "guide.features.cursors.lead":
    "사람이 많아도 화면이 어수선하지 않게, 다른 사람의 커서를 보이는 방식을 고를 수 있어요. 설정의 다른 사람 커서에서 바꿔요.",
  "guide.features.cursors.auto.title": "자동 (기본)",
  "guide.features.cursors.auto.body":
    "한 파일에 {crowd}명 이상이 있으면 커서가 흐려지고, 내 커서 가까이에서 움직이는 사람의 이름만 보여요. 발표하는 사람, 내가 따라가는 사람, 소유자는 이름이 계속 보여요.",
  "guide.features.cursors.moving.title": "움직일 때만",
  "guide.features.cursors.moving.body": "커서가 움직이는 동안에만 이름을 보여요.",
  "guide.features.cursors.always.title": "항상",
  "guide.features.cursors.always.body": "모든 사람의 이름을 늘 보여요.",
  "guide.features.cursors.carets.title": "커서만",
  "guide.features.cursors.carets.body": "이름 없이 색깔 있는 커서만 보여요.",
  "guide.features.cursors.hover":
    "어느 방식이든 커서에 마우스를 올리면 이름이 보이고, 목록에서 사람에게 올리면 그 사람의 커서가 강조돼요.",

  "guide.features.lab.title": "실습실 모드",
  "guide.features.lab.lead":
    "수업을 위한 모드예요. 강사가 실습실을 시작하고 6자리 코드를 알려 주면, 들어온 수강생마다 각자 작업할 복사본이 생겨요.",
  "guide.features.lab.start.title": "실습실 시작",
  "guide.features.lab.start.body":
    "주소창에 /lab/new를 열고 실습실 시작을 누르세요. 수강생은 첫 화면에 실습실 코드를 입력해요.",
  "guide.features.lab.grid.title": "모든 수강생 보기",
  "guide.features.lab.grid.body":
    "강사는 수강생 전체를 격자로 볼 수 있어요. 접속 중인지, 마지막으로 언제 고쳤는지, 코드 미리보기가 한눈에 보여요.",
  "guide.features.lab.help.title": "바로 가서 돕기",
  "guide.features.lab.help.body": "수강생 칸을 크게 보거나, 들어가서 함께 고칠 수 있어요.",
  "guide.features.lab.send.title": "예제 보내기",
  "guide.features.lab.send.body":
    "내 공유 중 하나를 골라 모두에게 보내요. 수강생마다 따로 복사본을 받아요.",
  "guide.features.lab.lock.title": "편집 잠금",
  "guide.features.lab.lock.body":
    "설명하는 동안 모든 수강생의 편집을 잠그고, 끝나면 풀어요. 잠겨 있어도 자기 복사본은 읽을 수 있어요.",
  "guide.features.lab.note":
    "실습실 모드는 코드를 보여 주고 고치게 할 뿐, 실행하거나 채점하지 않아요.",

  "guide.features.templates.title": "템플릿",
  "guide.features.templates.body1":
    "첫 화면의 템플릿으로 시작을 누르거나, 명령 팔레트에서 템플릿으로 새 공유 만들기를 실행하세요. 이름이나 언어로 찾고, 파일 목록과 미리보기를 확인한 뒤 공유를 만들어요.",
  "guide.features.templates.builtIn": "기본 제공",
  "guide.features.templates.body2":
    "관리자가 직접 만든 템플릿을 추가할 수 있고, 따로 묶여서 보여요.",

  "guide.features.more.title": "그 밖의 기능",
  "guide.features.more.palette.title": "명령 팔레트",
  "guide.features.more.palette.body":
    "단축키를 누르고 입력하면 동작, 내 공유, 템플릿을 찾을 수 있어요.",
  "guide.features.more.shares.title": "내 공유",
  "guide.features.more.shares.body":
    "공유를 저장하면 나중에 다시 찾을 수 있어요. 공유마다 폴더 하나와 태그를 최대 {tags}개 붙일 수 있고, 폴더와 태그는 나에게만 보여요.",
  "guide.features.more.format.title": "코드 정리",
  "guide.features.more.format.body": "단축키 하나로 파일을 깔끔하게 정리해요.",
  "guide.features.more.secret.title": "비밀 정보 경고",
  "guide.features.more.secret.body":
    "붙여넣은 글이 API 키나 비밀번호처럼 보이면 먼저 알려줘요. 관리자가 이 기능을 끌 수 있어요.",

  // ── 네트워크 ──
  "guide.network.title": "같은 네트워크라서 더 빠르게",
  "guide.network.lead":
    "gachipad는 내 네트워크 안의 서버에서 돌아가요. 같은 네트워크의 모든 기기가 서버에 바로 닿고, 입장 방법도 모두 그 점을 이용해요.",
  "guide.network.toc.why": "더 빠른 이유",
  "guide.network.toc.ways": "입장 방법 다섯 가지",
  "guide.network.toc.groups": "근처의 기준",
  "guide.network.toc.address": "짧은 주소",
  "guide.network.toc.size": "큰 파일 업로드",
  "guide.network.toc.offline": "인터넷이 필요 없어요",

  "guide.network.why.title": "더 빠른 이유",
  "guide.network.why.body1":
    "보통은 링크를 찾아 복사하고 메시지에 붙여넣어야 들어올 수 있어요. gachipad에서는 옆에 있는 사람이 이미 서버와 같은 네트워크에 있으니, 열려 있는 공유를 바로 보여 주고 상대 화면으로 보낼 수 있어요.",
  "guide.network.why.body2": "내 코드는 서버와 같은 공유에 있는 사람들하고만 오가요.",

  "guide.network.ways.title": "입장 방법 다섯 가지",
  "guide.network.ways.caption": "공유에 들어오는 방법",
  "guide.network.ways.way": "방법",
  "guide.network.ways.how": "어떻게 하나요",
  "guide.network.ways.who": "누구에게 닿나요",
  "guide.network.ways.code.how": "숫자 6개를 입력하거나 주소 뒤에 붙여요",
  "guide.network.ways.code.who": "코드를 아는 사람 누구나",
  "guide.network.ways.qr.how": "공유 창이나 프로젝터 화면에서 스캔해요",
  "guide.network.ways.qr.who": "화면을 볼 수 있고 같은 네트워크에 있는 사람",
  "guide.network.ways.nearby.how": "첫 화면 목록에서 공유를 골라요",
  "guide.network.ways.nearby.who":
    "같은 네트워크나 같은 방에 있는 사람. 공유에 PIN이나 승인이 있거나 소유자가 숨겼다면 제외예요",
  "guide.network.ways.send.how": "이름을 고르면 그 화면에 초대가 떠요",
  "guide.network.ways.send.who": "gachipad를 연 사람 한 명",
  "guide.network.ways.room.how": "버튼을 누르고 확인해요",
  "guide.network.ways.room.who": "같은 방의 모든 사람. 방이 없으면 네트워크 전체예요",

  "guide.network.groups.title": "근처의 기준",
  "guide.network.groups.body1":
    "근처 공유, 보내기, 방 전체에 띄우기는 모두 기기를 묶은 그룹 안에서 동작해요. 기본값은 같은 네트워크 대역, 즉 IPv4의 같은 /24에 있는 기기예요. 관리자가 접두사 길이를 바꿀 수 있어요.",
  "guide.network.groups.body2":
    "관리자는 주소 범위로 교실 같은 방을 정할 수도 있어요. 방에 있는 사람은 그 방의 공유만 보고, 방 전체에 띄우면 그 방에만 닿아요.",
  "guide.network.groups.body3":
    "목록에 올릴지는 소유자가 공유마다 정해요. PIN이나 승인이 있는 공유는 올라가지 않아요. 근처 공유 카드에는 제목과 코드의 처음 {lines}줄이 보여요.",
  "guide.network.groups.body4": "관리자는 새 공유를 기본적으로 목록에 올리지 않게 할 수도 있어요.",

  "guide.network.address.title": "짧은 주소",
  "guide.network.address.body1":
    "서버 주소는 한 번만 알면 돼요. 공유 창에 참여 코드 옆으로 주소가 보이고, QR 코드를 쓰면 주소를 입력하지 않아도 돼요.",
  "guide.network.address.body2":
    "관리자가 선택 기능인 이름 서비스를 켜 두었다면, mDNS를 지원하는 네트워크에서는 서버가 gachipad.local로도 응답해서 외울 게 없어요. 그렇지 않으면 서버의 평소 주소를 써요.",

  "guide.network.size.title": "큰 파일 업로드",
  "guide.network.size.body1":
    "파일, 폴더, .zip을 화면에 끌어다 놓거나 업로드 버튼으로 고르세요. 인터넷으로 나가지 않고 네트워크 안의 서버로 가서, 업로드 시간은 네트워크가 허락하는 만큼만 걸려요.",
  "guide.network.size.body2":
    "업로드 한 번의 제한은 관리자가 정하고 기본값은 {upload}MB예요. 공유 하나의 글 크기는 기본값이 5MB예요.",
  "guide.network.size.body3":
    "사람에게 파일을 바로 보낼 수도 있어요. 공유 창에서 이름 위에 파일을 놓으면 상대 화면에 알림이 뜨고 버튼으로 열어요.",

  "guide.network.offline.title": "인터넷이 필요 없어요",
  "guide.network.offline.body1":
    "스크립트, 글꼴, 아이콘이 모두 같은 서버에서 와요. 기기는 서버에만 연결되면 되니, 인터넷이 막힌 네트워크에서도 동작해요.",
  "guide.network.offline.body2":
    "관리자가 끄지 않았다면 서버가 스스로 새 버전을 확인하고, 로그인 제공자(OIDC, LDAP)를 설정했다면 그쪽과도 통신해요. 둘 다 개인정보 페이지에 설명이 있어요.",
  "guide.network.offline.link": "서버가 연결하는 곳",

  // ── 개인정보와 안전 ──
  "guide.security.title": "개인정보와 안전",
  "guide.security.lead":
    "gachipad가 무엇을 얼마나 보관하는지, 누가 볼 수 있는지, 무엇을 지울 수 있는지 알려드려요.",
  "guide.security.toc.stored": "저장되는 것",
  "guide.security.toc.deleted": "지운 내용",
  "guide.security.toc.history": "이력",
  "guide.security.toc.device": "내 기기의 사본",
  "guide.security.toc.external": "외부 요청 없음",
  "guide.security.toc.controls": "관리자가 정하는 것",
  "guide.security.toc.host": "직접 운영하기",

  "guide.security.stored.title": "서버에 저장되는 것",
  "guide.security.stored.contents.title": "공유 내용",
  "guide.security.stored.contents.body":
    "모든 파일의 현재 내용과 제목, 파일 이름이에요. 이력용 버전은 따로 저장돼요.",
  "guide.security.stored.people.title": "이름과 색",
  "guide.security.stored.people.body":
    "직접 고른 표시 이름과 색이에요. 관리자가 로그인을 켜지 않으면 비밀번호나 계정은 없어요.",
  "guide.security.stored.access.title": "코드와 접근 정보",
  "guide.security.stored.access.body":
    "참여 코드, 소유자가 차단한 사람, PIN의 해시값이에요. PIN 자체는 저장하지 않아요.",
  "guide.security.stored.audit.title": "감사 로그",
  "guide.security.stored.audit.body":
    "기본값은 꺼짐이에요. 관리자가 켜면 누가 공유를 만들고, 열고, 내려받고, 지웠는지 기록하고, 보관 기간(기본값 90일)이 지난 기록은 지워요.",
  "guide.security.stored.how": "얼마나 보관되나요",
  "guide.security.stored.save": "저장한 공유는 만료되지 않아요.",
  "guide.security.stored.code":
    "참여 코드는 공유가 있는 동안 유지돼요. 풀린 코드는 24시간 동안 다시 쓰이지 않아요.",

  "guide.security.deleted.title": "지운 내용은 다른 사람에게 가지 않아요",
  "guide.security.deleted.body1":
    "새로 들어온 사람은 공유의 현재 내용을 받아요. 입력했다가 지운 글은 받는 내용에 들어 있지 않아요.",
  "guide.security.deleted.body2":
    "입력하는 동안 공유에 있던 사람은 그 글을 입력하는 때에 봤어요. 나중에 들어온 사람은 받지 못해요.",

  "guide.security.history.title": "이력은 소유자만 봐요",
  "guide.security.history.body1":
    "소유자가 재생하고 복원할 수 있도록 공유의 버전을 서버에 저장해요. 이력은 소유자만 열 수 있어요.",
  "guide.security.history.body2":
    "보관 기간이 지난 버전은 지워지고, 그 안에 있던 지운 내용도 함께 사라져요.",

  "guide.security.device.title": "내 기기의 사본",
  "guide.security.device.body1":
    "연결이 끊겨도 변경이 남도록 gachipad는 이 브라우저에 공유의 오프라인 사본을 저장할 수 있어요. 편집기를 처음 열 때 물어보고, 허락하기 전에는 아무것도 저장하지 않아요.",
  "guide.security.device.body2":
    "여럿이 쓰는 컴퓨터에서는 이 기기에는 저장 안 함을 고르거나 따로 만든 브라우저 프로필을 쓰세요.",
  "guide.security.device.remove": "사본을 지우려면",
  "guide.security.device.forget.title": "이 기기에서 지우기",
  "guide.security.device.forget.body":
    "편집기 설정에 있어요. 이 브라우저의 모든 탭에서 그 공유를 닫고 사본과 저장된 편집 키를 지워요. 서버의 공유는 그대로예요.",
  "guide.security.device.off.title": "사본 저장 끄기",
  "guide.security.device.off.body": "설정에서 오프라인 사본 저장을 끄면 모든 사본이 지워져요.",
  "guide.security.device.signOut.title": "로그아웃하고 모두 지우기",
  "guide.security.device.signOut.body":
    "로그인한 경우에만 보여요. 로그아웃하고 이 브라우저의 모든 사본과 편집 키를 지워요.",
  "guide.security.device.auto.title": "자동으로 지워지는 경우",
  "guide.security.device.auto.body":
    "내보내지거나 차단됐을 때, 공유가 삭제되거나 만료됐을 때 사본이 지워져요. PIN이나 승인이 있는 공유는 다시 들어간 뒤에만 사본을 불러와요.",
  "guide.security.device.body3":
    "돌아오지 않는 브라우저에는 서버가 닿을 수 없어요. 일부 사본이 남았을 수 있다는 안내가 나오면 브라우저 설정에서 이 사이트의 데이터를 지우세요.",

  "guide.security.external.title": "외부 요청이 없어요",
  "guide.security.external.body1":
    "페이지, 스크립트, 글꼴, 아이콘, 이미지가 모두 내 gachipad 서버에서 와요. 분석 도구, 광고, 추적기, 콘텐츠 전송 네트워크를 쓰지 않아요. 기본 설정에서 브라우저는 gachipad 서버 말고는 어디에도 연결하지 않아요.",
  "guide.security.external.body2":
    "관리자가 어떻게 설정하느냐에 따라 예외가 두 가지 있어요. 로그인에 인증 제공자(OIDC)를 쓰면 브라우저가 로그인하러 그 제공자로 이동하고, LDAP을 쓰면 서버가 디렉터리 서버에 로그인을 확인해요. 나머지 하나는 서버에서 일어나요. 관리자가 끄지 않았다면 서버가 약 12시간마다 GitHub에 새 버전이 있는지 묻는 요청을 보내요. 공유 내용은 담기지 않고, 인터넷이 없으면 조용히 실패해요.",
  "guide.security.external.body3":
    "편집 링크의 키는 # 뒤에 있어서 브라우저가 페이지 요청에 실어 보내지 않아요. 그래서 서버 로그와 주소에 남지 않고, gachipad는 확인을 위해 참여 요청 본문에 한 번 실어 보내요. PIN은 해시값으로만 저장해요.",

  "guide.security.controls.title": "관리자가 정하는 것",
  "guide.security.controls.lead": "아래는 이 서버의 관리자가 정해요.",
  "guide.security.controls.lifetime": "저장하지 않은 공유가 유지되는 시간",
  "guide.security.controls.history": "이력을 보관하는 기간",
  "guide.security.controls.sizes": "공유와 업로드의 크기 제한",
  "guide.security.controls.guests": "게스트 허용 여부와 OIDC, LDAP 로그인",
  "guide.security.controls.rooms": "방, 그리고 새 공유를 근처 공유에 올릴지",
  "guide.security.controls.audit": "감사 로그와 보관 기간",
  "guide.security.controls.secrets": "붙여넣은 키와 비밀번호에 대한 경고",
  "guide.security.controls.templates": "템플릿과 하단에 보이는 문의처",
  "guide.security.controls.note":
    "서버와 데이터베이스를 운영하는 사람은 저장된 내용에 접근할 수 있어요. 네트워크의 모든 사람이 보면 안 되는 내용에는 PIN이나 승인을 쓰고, 이 서버의 규칙은 관리자에게 물어보세요.",

  "guide.security.host.title": "직접 운영하기",
  "guide.security.host.body1":
    "gachipad는 MIT 라이선스의 오픈소스예요. Docker Compose로 내 서버에서 돌려요. 웹 서버, API, 편집 서비스, MongoDB, Valkey로 이루어져 있고, 선택 서비스로 gachipad.local 이름을 추가할 수 있어요.",
  "guide.security.host.body2":
    "외부 서비스에 기대는 곳이 없고, 릴리스마다 인터넷이 없는 네트워크용 오프라인 번들이 함께 나와요.",

  // ── 질문 ──
  "guide.faq.title": "자주 묻는 질문",
  "guide.faq.lead": "주제별로 묶은 짧은 답이에요. 질문을 누르면 열려요.",
  "guide.faq.group.start": "시작하기",
  "guide.faq.group.people": "입장과 접근",
  "guide.faq.group.edit": "편집",
  "guide.faq.group.network": "네트워크와 개인정보",
  "guide.faq.account.q": "계정이 있어야 하나요?",
  "guide.faq.account.a":
    "아니요. 이름을 정하고 바로 시작하면 돼요. 관리자가 로그인을 켰다면 로그인할 수 있고, 게스트를 막지 않았다면 게스트도 계속 쓸 수 있어요.",
  "guide.faq.run.q": "gachipad에서 코드를 실행할 수 있나요?",
  "guide.faq.run.a":
    "아니요. gachipad는 텍스트를 공유하고 같이 고치는 도구이고, 코드를 실행하지는 않아요.",
  "guide.faq.cantEdit.q": "왜 고칠 수 없나요?",
  "guide.faq.cantEdit.a":
    "소유자가 공유를 보기 전용으로 정했거나 잠시 편집을 잠갔을 수 있어요. 소유자에게 편집 링크를 달라고 하거나 편집 잠금을 풀어 달라고 하세요.",
  "guide.faq.pin.q": "PIN을 잊어버렸어요",
  "guide.faq.pin.a":
    "소유자만 도와줄 수 있어요. 소유자는 공유를 볼 수 있으니 새 PIN을 정해서 알려 줄 수 있어요. 여러 번 틀리면 몇 분 기다려야 해요.",
  "guide.faq.notNearby.q": "내 공유가 근처 공유에 안 보여요",
  "guide.faq.notNearby.a":
    "PIN이나 입장 승인이 있는 공유는 목록에 나오지 않고, 소유자가 숨길 수도 있어요. 같은 네트워크나 같은 방에 있는 사람만 볼 수 있어요.",
  "guide.faq.codeFails.q": "코드가 안 돼요",
  "guide.faq.codeFails.a":
    "숫자 6개를 다시 확인하세요. 공유가 만료되었거나 삭제되면 코드도 쓸 수 없어지고, 풀린 코드는 24시간 동안 다시 쓰이지 않아요. 새 코드를 요청하세요.",
  "guide.faq.offline.q": "연결이 끊기면 어떻게 되나요?",
  "guide.faq.offline.a":
    "계속 입력하세요. 변경 내용은 보관되고 연결이 돌아오면 합쳐져요. 오프라인 사본을 저장하지 않기로 했다면 열려 있는 탭에만 있으니 탭을 닫지 마세요.",
  "guide.faq.size.q": "공유는 얼마나 클 수 있나요?",
  "guide.faq.size.a":
    "제한은 관리자가 정해요. 기본값은 공유 하나의 글 5MB, 업로드 한 번 {upload}MB예요.",
  "guide.faq.folder.q": "폴더를 올릴 수 있나요?",
  "guide.faq.folder.a":
    "네. 파일, 폴더, .zip을 화면 어디에나 끌어다 놓거나 더 보기 메뉴의 파일 올리기를 쓰세요. 공유 하나에 파일을 최대 {max}개까지 둘 수 있어요.",
  "guide.faq.duplicate.q": "같은 이름 파일을 올리면?",
  "guide.faq.duplicate.a":
    "이름과 내용이 모두 같으면 있는 파일을 열어 줘요. 이름은 같고 내용이 다르면 main (2).py처럼 번호를 붙여 따로 추가하고, 있던 파일은 덮어쓰지 않아요.",
  "guide.faq.uploadFails.q": "파일이 안 올라가요",
  "guide.faq.uploadFails.a":
    "먼저 파일을 추가할 수 있는 사람인지 확인하세요. 보기 전용이거나, 편집자인데 소유자가 파일 추가를 허용하지 않았다면 추가할 수 없어요. 그다음 알림에 나온 이유를 보세요. 텍스트가 아닌 파일, {perFile}MB를 넘는 파일, 한 번에 {max}개를 넘는 파일, 크기 제한을 넘는 파일은 건너뛰어요. 끌어다 놓기가 안 되면 더 보기 메뉴의 파일 올리기를 써 보세요.",
  "guide.faq.cursors.q": "다른 사람 커서가 거슬려요",
  "guide.faq.cursors.a":
    "설정의 다른 사람 커서에서 보이는 방식을 바꿀 수 있어요. 이름 없이 커서만 보거나, 움직일 때만 이름을 보게 할 수 있어요. 한 파일에 여럿이 있으면 기본값인 자동이 알아서 줄여 줘요.",
  "guide.faq.history.q": "이력은 누가 볼 수 있나요?",
  "guide.faq.history.a":
    "소유자만 볼 수 있어요. 이력에 있는 지운 내용은 다른 사람에게 전달되지 않고, 오래된 버전은 보관 기간이 지나면 지워져요.",
  "guide.faq.internet.q": "인터넷이 필요한가요?",
  "guide.faq.internet.a":
    "아니요. 모든 것이 네트워크 안의 서버에서 와요. 서버는 새 버전을 확인할 수 있고, 관리자가 이 기능을 끌 수 있어요.",
  "guide.faq.tracking.q": "추적하나요?",
  "guide.faq.tracking.a":
    "분석 도구, 광고, 추적기가 없고 기본 설정에서 브라우저는 gachipad 서버에만 연결해요(관리자가 설정한 로그인 제공자는 예외예요). 관리자가 감사 로그를 켰다면 누가 공유를 만들고, 열고, 내려받고, 지웠는지는 기록돼요.",
  "guide.faq.shared.q": "여럿이 쓰는 컴퓨터에 흔적을 남기지 않으려면요?",
  "guide.faq.shared.a":
    "오프라인 사본을 물을 때 이 기기에는 저장 안 함을 고르거나, 다 쓴 뒤 편집기 설정의 이 기기에서 지우기를 누르세요.",
  "guide.faq.contact.q": "이 서버에 대해서는 누구에게 물어야 하나요?",
  "guide.faq.contact.a":
    "관리자가 문의처를 정해 두었다면 페이지 하단에 보여요. 만료 시간이나 크기 제한 같은 규칙은 관리자가 답할 수 있어요.",
};
