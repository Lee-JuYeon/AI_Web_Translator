// background.js - IntersectionObserver 호환 버전
(function() {
  'use strict';
  
  // 상수 및 설정
  const APP_CONFIG = {
    menuItemId: "tony_translate",
    contentScripts: [
      "utils/cache-manager.js", 
      "utils/usage-manager.js",
      "utils/ui-manager.js",
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
        console.log("[번역 익스텐션] 모든 스크립트 로드 완료, 번역 요청 전송");
        chrome.tabs.sendMessage(tabId, { action: "translatePage" })
          .catch(err => console.error("[번역 익스텐션] 번역 요청 전송 오류:", err));
        return;
      }
      
      console.log(`[번역 익스텐션] ${APP_CONFIG.contentScripts[index]} 로드 중...`);
      
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: [APP_CONFIG.contentScripts[index]]
      }).then(() => {
        console.log(`[번역 익스텐션] ${APP_CONFIG.contentScripts[index]} 로드 성공`);
        // 다음 스크립트 로드
        loadScriptSequentially(index + 1);
      }).catch((err) => {
        console.error(`[번역 익스텐션] ${APP_CONFIG.contentScripts[index]} 로드 실패:`, err);
        
        // 핵심 모듈 로드 실패 시 중단
        if (index < 4) {  // cache-manager.js, usage-manager.js, ui-manager.js, translator-service.js는 필수
          console.error("[번역 익스텐션] 핵심 모듈 로드 실패로 번역을 중단합니다.");
          return;
        }
        
        // 그 외 모듈은 건너뛰고 계속 진행
        loadScriptSequentially(index + 1);
      });
    };

    // content-script가 이미 로드되었는지 확인
    chrome.tabs.sendMessage(tabId, { action: "ping" })
      .then(response => {
        if (response && response.status === "ready") {
          // 이미 로드된 경우 바로 번역 요청
          console.log("[번역 익스텐션] 콘텐츠 스크립트가 이미 로드됨");
          chrome.tabs.sendMessage(tabId, { action: "translatePage" });
        } else {
          // 순차적으로 스크립트 로드 시작
          loadScriptSequentially();
        }
      })
      .catch(error => {
        console.log("[번역 익스텐션] 콘텐츠 스크립트 확인 실패, 새로 로드합니다:", error);
        // 순차적으로 스크립트 로드 시작
        loadScriptSequentially();
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
      const { action } = request;
      console.log("🧩 메시지 수신:", action);
      
      // 메시지 타입별 핸들러 객체
      const messageHandlers = {
        // 팝업 열기
        openPopup: () => {
          chrome.action.openPopup();
          sendResponse({ success: true });
          return true;
        },
        
        // 설정 업데이트 처리
        updateSettings: () => {
          if (!request.settings) {
            sendResponse({ success: false, error: "설정 값이 없습니다" });
            return true;
          }
          
          chrome.storage.sync.set({ settings: request.settings }, () => {
            // 열려있는 모든 탭에 설정 업데이트 알림
            broadcastToAllTabs({
              action: "updateSettings",
              settings: request.settings
            });
            
            sendResponse({ success: true });
          });
          return true;
        },
        
        // 사용량 통계 가져오기
        getUsageStats: () => {
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
        },
        
        // 캐시 정리 요청
        clearCache: () => {
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
        },
        
        // 누락된 모듈 로드 요청
        loadScripts: () => {
          if (!Array.isArray(request.scripts) || request.scripts.length === 0) {
            sendResponse({ success: false, error: "유효한 스크립트 목록이 필요합니다" });
            return true;
          }
          
          console.log("[번역 익스텐션] 누락된 모듈 로드 요청 수신:", request.scripts);
          
          if (!sender.tab) {
            sendResponse({ success: false, error: "탭 정보 없음" });
            return true;
          }
          
          const tabId = sender.tab.id;
          const loadPromises = [];
          
          // 각 스크립트 로드 요청을 병렬로 처리
          request.scripts.forEach(script => {
            const loadPromise = chrome.scripting.executeScript({
              target: { tabId },
              files: [script]
            })
            .then(() => {
              console.log(`[번역 익스텐션] ${script} 수동 로드 성공`);
              return { script, success: true };
            })
            .catch(error => {
              console.error(`[번역 익스텐션] ${script} 수동 로드 실패:`, error);
              return { script, success: false, error: error.message };
            });
            
            loadPromises.push(loadPromise);
          });
          
          // 모든 로드 요청 완료 후 응답
          Promise.all(loadPromises)
            .then(results => {
              sendResponse({ 
                success: true, 
                results: results,
                allSucceeded: results.every(r => r.success)
              });
            })
            .catch(error => {
              sendResponse({ 
                success: false, 
                error: `스크립트 로드 중 오류 발생: ${error.message}` 
              });
            });
          
          return true;
        }
      };
      
      // 지정된 핸들러 호출 또는 기본 응답
      if (messageHandlers[action]) {
        return messageHandlers[action]();
      }
      
      // 해당하는 핸들러가 없는 경우
      console.warn(`[번역 익스텐션] 처리되지 않은 메시지 타입: ${action}`);
      return false;
    });

    /**
     * 모든 열린 탭에 메시지 전송
     * @param {Object} message - 전송할 메시지 객체
     */
    function broadcastToAllTabs(message) {
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          try {
            chrome.tabs.sendMessage(tab.id, message).catch(err => {
              // content-script가 로드되지 않은 탭에 대한 오류는 무시
              if (!err.message.includes("Receiving end does not exist")) {
                console.warn(`[번역 익스텐션] 탭 ${tab.id} 메시지 전송 오류:`, err);
              }
            });
          } catch (err) {
            // 오류 무시 (content-script가 로드되지 않은 탭)
          }
        });
      });
    }

    /**
     * 현재 월 구하기 (yyyy-mm 형식)
     * @returns {string} - 현재 월 (yyyy-mm)
     */
    function getCurrentMonth() {
      const date = new Date();
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    }
    
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