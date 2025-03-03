// 월간 사용량 리셋 설정
function setupMonthlyReset() {
  // 매일 자정에 체크
  chrome.alarms.create('checkMonthlyReset', { periodInMinutes: 60 * 24 });
  
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'checkMonthlyReset') {
      const usage = await UsageManager.getCurrentUsage();
      const currentMonth = UsageManager.getCurrentMonth();
      
      // 현재 저장된 월과 현재 월이 다르면 리셋
      if (usage.month !== currentMonth) {
        const newUsage = {
          month: currentMonth,
          tokensUsed: 0,
          lastReset: new Date().toISOString()
        };
        
        chrome.storage.sync.set({ usage: newUsage });
        console.log('[번역 익스텐션] 월간 사용량 리셋 완료');
      }
    }
  });
}


// 현재 월 구하기 (yyyy-mm 형식) - UsageManager 없이 직접 구현
function getCurrentMonth() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// 월간 사용량 확인 및 리셋
function checkAndResetMonthlyUsage() {
  chrome.storage.sync.get('usage', (data) => {
    const currentMonth = getCurrentMonth();
    
    // 사용량 데이터가 없거나 월이 변경된 경우
    if (!data.usage || data.usage.month !== currentMonth) {
      const newUsage = {
        month: currentMonth,
        tokensUsed: 0,
        lastReset: new Date().toISOString()
      };
      
      chrome.storage.sync.set({ usage: newUsage });
      console.log('[번역 익스텐션] 월간 사용량 리셋 완료');
    }
  });
}



const menuItemId = "tony";

chrome.runtime.onInstalled.addListener(() => {

  // 컨텍스트 메뉴 생성
  chrome.contextMenus.create({
    id: menuItemId,
    title: "자연스럽게 번역하기",
    contexts: ["page"]
  });

  // 월간 사용량 리셋 설정
  setupMonthlyReset();

});

// 컨텍스트 메뉴 클릭 이벤트 처리
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === menuItemId) {
    console.log("🌍 우클릭 메뉴가 클릭됨, content-script 실행...");

    // content-script가 이미 로드되었는지 확인 후 메시지 전송
    chrome.tabs.sendMessage(tab.id, { action: "ping" }, response => {
      const hasError = chrome.runtime.lastError;
      
      if (hasError || !response) {
        // content-script가 로드되지 않은 경우에만 로드
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["utils/usage-manager.js", "content-script.js"]
        }).then(() => {
          // 로드 후 번역 요청
          chrome.tabs.sendMessage(tab.id, { action: "translatePage" });
        }).catch((err) => {
          console.error("content-script.js 실행 실패:", err);
        });
      } else {
        // 이미 로드된 경우 바로 번역 요청
        chrome.tabs.sendMessage(tab.id, { action: "translatePage" });
      }
    });
  }
});

// 컨텐츠 스크립트와 통신
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("🧩 AI Web Translator ON..!");

  if (request.action === "openPopup") {
    chrome.action.openPopup();
    sendResponse({success: true});
    return true;
  }

  return false; 

});

