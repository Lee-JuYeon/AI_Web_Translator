// background.js - IntersectionObserver 호환 버전
(function() {
  'use strict';
  
  // 상수 및 설정
  const APP_CONFIG = {
    menuItemId: "tony_translate",
    contentScripts: [
      "utils/cache-manager.js",
      "utils/usage-manager.js", 
      "utils/dom/dom-selector.js",
      "utils/dom/dom-observer.js",
      "utils/dom/dom-manipulator.js",
      "utils/batch/batch_engine.js",
      "utils/translator-service.js",
      "utils/dom/dom-handler.js",
      "content-script.js"
    ]
  };

  // 컨텍스트 메뉴 생성
  function createContextMenu() {
    // 기존 메뉴 항목이 있으면 먼저 삭제
    try {
      chrome.contextMenus.remove(APP_CONFIG.menuItemId, () => {
        // 삭제 후 새로 생성 (lastError 무시)
        if (chrome.runtime.lastError) {
          // 아이템이 없어서 발생하는 오류는 무시
        }
        
        // 메뉴 생성
        chrome.contextMenus.create({
          id: APP_CONFIG.menuItemId,
          title: "자연스럽게 번역하기",
          contexts: ["page"]
        });
      });
    } catch (e) {
      // 오류가 발생해도 메뉴 생성 시도
      chrome.contextMenus.create({
        id: APP_CONFIG.menuItemId,
        title: "자연스럽게 번역하기",
        contexts: ["page"]
      }, () => {
        if (chrome.runtime.lastError) {
          console.log("메뉴 생성 오류 (무시됨):", chrome.runtime.lastError);
        }
      });
    }
  }

  // 월간 사용량 리셋 설정
  function setupMonthlyReset() {
    // 매일 자정에 체크 (24시간마다)
    chrome.alarms.create('checkMonthlyReset', { periodInMinutes: 60 * 24 });
    
    chrome.alarms.onAlarm.addListener(async (alarm) => {
      if (alarm.name === 'checkMonthlyReset') {
        checkAndResetMonthlyUsage();
      }
    });
    
    console.log('[번역 익스텐션] 월간 사용량 리셋 체크 알람 설정됨');
  }

  // 현재 월 구하기 (yyyy-mm 형식)
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

  // 컨텍스트 메뉴 및 기본 설정 초기화
  function initializeExtension() {
    // 컨텍스트 메뉴 생성
    createContextMenu();
    
    // 월간 사용량 리셋 설정
    setupMonthlyReset();
    
    // 설치 후 첫 실행 시 사용량 초기화
    checkAndResetMonthlyUsage();
    
    console.log('[번역 익스텐션] 초기화 완료');
  }
  
  // 컨텐츠 스크립트 로드 및 메시지 전송
  function loadContentScriptsAndTranslate(tabId) {
    // 스크립트를 순차적으로 로드
    const loadScriptSequentially = (index = 0) => {
      if (index >= APP_CONFIG.contentScripts.length) {
        // 모든 스크립트 로드 완료 후 번역 요청
        chrome.tabs.sendMessage(tabId, { action: "translatePage" });
        return;
      }
      
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: [APP_CONFIG.contentScripts[index]]
      }).then(() => {
        // 다음 스크립트 로드
        loadScriptSequentially(index + 1);
      }).catch((err) => {
        console.error(`${APP_CONFIG.contentScripts[index]} 실행 실패:`, err);
        
        // 오류가 발생해도 계속 진행 (가능한 경우)
        if (index + 1 < APP_CONFIG.contentScripts.length) {
          loadScriptSequentially(index + 1);
        } else {
          // 최선의 노력으로 번역 시도
          try {
            chrome.tabs.sendMessage(tabId, { action: "translatePage" });
          } catch (e) {
            console.error("번역 요청 실패:", e);
          }
        }
      });
    };

    // content-script가 이미 로드되었는지 확인
    chrome.tabs.sendMessage(tabId, { action: "ping" }, response => {
      const hasError = chrome.runtime.lastError;
      
      if (hasError || !response) {
        // 순차적으로 스크립트 로드 시작
        loadScriptSequentially();
      } else {
        // 이미 로드된 경우 바로 번역 요청
        chrome.tabs.sendMessage(tabId, { action: "translatePage" });
      }
    });
  }

  // 이벤트 리스너 등록
  function setupEventListeners() {
    // 컨텍스트 메뉴 클릭 이벤트 처리
    chrome.contextMenus.onClicked.addListener((info, tab) => {
      if (info.menuItemId === APP_CONFIG.menuItemId) {
        console.log("🌍 우클릭 메뉴가 클릭됨, content-script 실행...");
        loadContentScriptsAndTranslate(tab.id);
      }
    });
    
    // 컨텐츠 스크립트와 통신
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      console.log("🧩 메시지 수신:", request.action);
      
      switch (request.action) {
        case "openPopup":
          chrome.action.openPopup();
          sendResponse({success: true});
          return true;
          
        case "updateSettings":
          // 설정 업데이트 처리
          if (request.settings) {
            chrome.storage.sync.set({ settings: request.settings }, () => {
              // 열려있는 모든 탭에 설정 업데이트 알림
              chrome.tabs.query({}, (tabs) => {
                tabs.forEach(tab => {
                  try {
                    chrome.tabs.sendMessage(tab.id, { 
                      action: "updateSettings", 
                      settings: request.settings 
                    });
                  } catch (err) {
                    // 오류 무시 (content-script가 로드되지 않은 탭)
                  }
                });
              });
              
              sendResponse({success: true});
            });
            return true;
          }
          break;
          
        case "getUsageStats":
          // 사용량 통계를 요청한 경우 (popup.js에서 사용)
          chrome.storage.sync.get(['usage', 'subscription'], (data) => {
            sendResponse({
              usage: data.usage || {
                month: getCurrentMonth(),
                tokensUsed: 0,
                lastReset: new Date().toISOString()
              },
              subscription: data.subscription || 'FREE'
            });
          });
          return true;
          
        case "clearCache":
          // 캐시 정리 요청 (popup.js에서 사용)
          chrome.storage.local.get(null, (items) => {
            const cacheKeys = Object.keys(items).filter(key => 
              key.startsWith('translate_')
            );
            
            if (cacheKeys.length > 0) {
              chrome.storage.local.remove(cacheKeys, () => {
                sendResponse({
                  success: true, 
                  clearedItems: cacheKeys.length
                });
              });
            } else {
              sendResponse({
                success: true, 
                clearedItems: 0
              });
            }
          });
          return true;
      }
      
      return false; 
    });
    
    // 확장 프로그램 설치 또는 업데이트 시 실행
    chrome.runtime.onInstalled.addListener((details) => {
      if (details.reason === 'install' || details.reason === 'update') {
        initializeExtension();
      }
    });
  }
  
  // 백그라운드 스크립트 초기화
  function init() {
    setupEventListeners();
    
    // 확장 프로그램이 이미 실행 중인 경우 초기화 실행
    initializeExtension();
  }
  
  // 백그라운드 스크립트 실행
  init();
})();