// 만든 이미지 보내기: 휴대폰은 공유 시트(navigator.share), 안 되면 파일로 내려받아요.
// 출근표 이미지(33-export.js)가 써요. 예전 한 달 출근표(html2canvas)는 2026-11-02 에 출근표 이미지로 합쳤어요.
{
  const A = window.App;

  async function deliver(blob, name) {
    const file = new File([blob], name, { type: 'image/png' });
    // 휴대폰: 공유 시트 → '이미지 저장' 또는 단톡방
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    // 컴퓨터: 바로 내려받기
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    A.toast('이미지를 저장했어요');
  }

  A.capture = { deliver };
}
