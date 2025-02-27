const menuItemId = "tony";

chrome.runtime.onInstalled.addListener(() => {

  // 컨텍스트 메뉴 생성
  chrome.contextMenus.create({
    id: menuItemId,
    title: "자연스럽게 번역하기",
    contexts: ["page"]
  });

});

// 컨텍스트 메뉴 클릭 이벤트 처리
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === menuItemId) {
    console.log("🌍 우클릭 메뉴가 클릭됨, content.js 실행...");

    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content-script.js"]
    }).then(() => {
    // 현재 탭에 content-script의 함수 실행 요청
    chrome.tabs.sendMessage(tab.id, { action: "translatePage" }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("오류 발생:", chrome.runtime.lastError);
        } else {
          console.log("번역 완료 응답:", response);
        }
      });
    }).catch((err) => {
      console.error("content.js 실행 실패:", err);
    });
  }
});

// 컨텐츠 스크립트와 통신
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("🧩 AI Web Translator ON..!");

  if (request.action === "translatePage") {
    console.log("📥 번역 요청 수신!");

    // 여기서 AI 서비스와 통신하여 번역 요청
    // 실제 구현에서는 API 키와 엔드포인트 필요
    translateTextsWithAI(request.textList)
      .then(translatedTexts => {
        chrome.tabs.sendMessage(sender.tab.id, {
          action: "updateTranslatedTexts",
          translatedTexts: translatedTexts
        });
        sendResponse({ success: true });
      })
      .catch(error => {
        console.error("Translation error:", error);
        sendResponse({ success: false, error: error.message });
      });


    return true;
  }
});


// AI 서비스와 통신하여 번역 요청 (실제 구현 필요)
async function translateTextsWithAI(textList) {
  // 실제 구현에서는 API 키와 엔드포인트 필요
  // 예시 코드
  try {
    // 여기에 실제 API 호출 코드 작성
    // const response = await fetch('AI_API_ENDPOINT', {...});
    // return await response.json();
    
    // 임시 예시 코드 (실제 구현 시 대체 필요)
    return textList.map(item => {
      return [item[0], `한국어로 번역된 ${item[0].substring(0, 10)}...`, item[2]];
    });
  } catch (error) {
    console.error("API call error:", error);
    throw error;
  }
}
