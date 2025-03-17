// background.js - 전역 설정 활용 리팩토링 버전
(function() {
  'use strict';
  
  // 확장 프로그램 기본 설정
  const APP_CONFIG = {
    menuItemId: 'tony_translate',
    appName: 'Tony번역',
    contentScripts: [
      'config.js', // config.js를 맨 처음에 로드하도록 명시적으로 지정
      'utils/cache-manager.js', 
      'utils/usage-manager.js',
      'utils/ui-manager.js',
      'utils/dom/dom-selector.js',   
      'utils/dom/dom-observer.js',     
      'utils/dom/dom-manipulator.js',
      'utils/batch/batch_engine.js',     
      'utils/translator-service.js',
      'utils/dom/dom-handler.js',        
      'content-script.js'
    ],
    defaultSettings: {
      targetLang: getBrowserLanguage(),
      autoTranslate: false
    },
    cacheSettings: {
      keyPrefix: 'translate_'
    }
  };
  
  // 기본 언어 설정 함수
  function getBrowserLanguage() {
    const browserLang = navigator.language.split('-')[0];
    const supportedLanguages = ['ko', 'en', 'ja', 'zh', 'es', 'fr', 'de'];
    return supportedLanguages.includes(browserLang) ? browserLang : 'ko';
  }
  
  // 현재 월 구하기 함수
  function getCurrentMonth() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
  
  // 확장 프로그램 설치 및 업데이트 이벤트
  chrome.runtime.onInstalled.addListener(handleExtensionInstalled);
  
  // 메시지 이벤트 리스너
  chrome.runtime.onMessage.addListener(handleMessage);
  
  // 컨텍스트 메뉴 등록
  setupContextMenu();
  
  // 월간 사용량 리셋 설정
  setupMonthlyReset();
  
  /**
   * 확장 프로그램 설치/업데이트 처리
   * @param {Object} details - 설치/업데이트 상세 정보
   */
  function handleExtensionInstalled(details) {
    // 설치 타입에 따른 처리
    switch (details.reason) {
      case 'install':
        // 초기 설정
        initializeSettings();
        break;
        
      case 'update':
        // 업데이트 기록
        logUpdate(details.previousVersion);
        
        // 설정 마이그레이션 (필요시)
        migrateSettings(details.previousVersion);
        break;
        
      default:
        // 기타 이벤트는 무시
        break;
    }
  }
  
  /**
   * 초기 설정 초기화
   */
  function initializeSettings() {
    // 기본 설정 생성
    const defaultSettings = {
      ...APP_CONFIG.defaultSettings,
      targetLang: getBrowserLanguage()
    };
    
    chrome.storage.sync.set({ settings: defaultSettings });
    
    // 사용량 통계 초기화
    initUsageStats();
  }
  
  /**
   * 사용량 통계 초기화
   */
  function initUsageStats() {
    const currentMonth = getCurrentMonth();
    
    const initialUsage = {
      month: currentMonth,
      tokensUsed: 0,
      lastReset: new Date().toISOString()
    };
    
    chrome.storage.sync.set({ usage: initialUsage });
  }
  
  /**
   * 업데이트 로깅
   * @param {string} previousVersion - 이전 버전
   */
  function logUpdate(previousVersion) {
    console.log(`[${APP_CONFIG.appName}] 업데이트 완료: ${previousVersion} → ${chrome.runtime.getManifest().version}`);
    
    // 업데이트 히스토리 저장 (최근 5개)
    chrome.storage.local.get('updateHistory', (data) => {
      const history = data.updateHistory || [];
      
      history.unshift({
        date: new Date().toISOString(),
        from: previousVersion,
        to: chrome.runtime.getManifest().version
      });
      
      // 최근 5개만 유지
      const updatedHistory = history.slice(0, 5);
      
      chrome.storage.local.set({ updateHistory: updatedHistory });
    });
  }
  
  /**
   * 설정 마이그레이션
   * @param {string} previousVersion - 이전 버전
   */
  function migrateSettings(previousVersion) {
    chrome.storage.sync.get('settings', (data) => {
      if (!data.settings) return; // 설정이 없으면 무시
      
      let updatedSettings = { ...data.settings };
      let needsUpdate = false;
      
      // 버전별 마이그레이션 로직
      if (compareVersions(previousVersion, '1.0.0') < 0) {
        // 새로운 기본값으로 업데이트
        Object.entries(APP_CONFIG.defaultSettings).forEach(([key, value]) => {
          if (updatedSettings[key] === undefined) {
            updatedSettings[key] = value;
            needsUpdate = true;
          }
        });
      }
      
      // 설정 업데이트가 필요한 경우
      if (needsUpdate) {
        chrome.storage.sync.set({ settings: updatedSettings });
      }
    });
  }
  
  /**
   * 버전 비교 함수
   * @param {string} v1 - 버전 1
   * @param {string} v2 - 버전 2
   * @returns {number} - 비교 결과 (-1: v1 < v2, 0: v1 = v2, 1: v1 > v2)
   */
  function compareVersions(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const num1 = i < parts1.length ? parts1[i] : 0;
      const num2 = i < parts2.length ? parts2[i] : 0;
      
      if (num1 < num2) return -1;
      if (num1 > num2) return 1;
    }
    
    return 0;
  }
  
  /**
   * 확장 프로그램 메시지 처리
   * @param {Object} message - 메시지 객체
   * @param {Object} sender - 발신자 정보
   * @param {Function} sendResponse - 응답 함수
   * @returns {boolean} - 비동기 응답 여부
   */
  function handleMessage(message, sender, sendResponse) {
    // 메시지 타입에 따른 처리
    switch (message.action) {
      case 'translatePage':
        handleTranslatePageMessage(sender.tab);
        return false;
        
      case 'getUsageStats':
        handleGetUsageStatsMessage(sendResponse);
        return true; // 비동기 응답
        
      case 'updateSettings':
        handleUpdateSettingsMessage(message.settings, sendResponse);
        return true; // 비동기 응답
        
      case 'clearCache':
        handleClearCacheMessage(sendResponse);
        return true; // 비동기 응답
        
      case 'loadScripts':
        handleLoadScriptsMessage(message.scripts, sender.tab, sendResponse);
        return true; // 비동기 응답
        
      case 'openPopup':
        chrome.action.openPopup();
        return false;
        
      default:
        console.warn(`[${APP_CONFIG.appName}] 알 수 없는 메시지: ${message.action}`);
        return false;
    }
  }
  
  /**
   * 페이지 번역 메시지 처리
   * @param {Object} tab - 탭 정보
   */
  function handleTranslatePageMessage(tab) {
    if (!tab || !tab.id) return;
    
    // 콘텐츠 스크립트에 번역 요청 메시지 전송
    chrome.tabs.sendMessage(tab.id, { action: 'translatePage' })
      .catch(error => {
        console.warn(`[${APP_CONFIG.appName}] 번역 메시지 전송 오류: ${error.message}`);
        
        // 콘텐츠 스크립트 로드 후 다시 시도
        loadContentScriptsAndTranslate(tab.id);
      });
  }
  
  /**
   * 설정 업데이트 메시지 처리
   * @param {Object} settings - 업데이트할 설정
   * @param {Function} sendResponse - 응답 함수
   */
  function handleUpdateSettingsMessage(settings, sendResponse) {
    if (!settings) {
      sendResponse({ success: false, error: "설정 값이 없습니다" });
      return;
    }
    
    chrome.storage.sync.set({ settings }, () => {
      // 열려있는 모든 탭에 설정 업데이트 알림
      broadcastToAllTabs({
        action: "updateSettings",
        settings: settings
      });
      
      sendResponse({ success: true });
    });
  }
  
  /**
   * 사용량 통계 요청 메시지 처리
   * @param {Function} sendResponse - 응답 함수
   */
  function handleGetUsageStatsMessage(sendResponse) {
    chrome.storage.sync.get(['usage', 'subscription'], (data) => {
      const subscription = data.subscription || 'FREE';
      const usage = data.usage || {
        month: getCurrentMonth(),
        tokensUsed: 0,
        lastReset: new Date().toISOString()
      };
      
      const subscriptionLimits = {
        FREE: 15000,   // 무료 회원: 약 15,000 토큰 (약 30페이지)
        BASIC: 100000  // 기본 회원($5): 약 100,000 토큰 (약 200페이지)
      };
      
      const limit = subscriptionLimits[subscription] || subscriptionLimits.FREE;
      const tokensUsed = usage.tokensUsed || 0;
      const remaining = Math.max(0, limit - tokensUsed);
      const percentage = Math.min(100, Math.round((tokensUsed / limit) * 100));
      
      sendResponse({
        usage: {
          subscription,
          tokensUsed,
          limit,
          remaining,
          percentage,
          lastReset: usage.lastReset
        }
      });
    });
  }
  
  /**
   * 캐시 정리 메시지 처리
   * @param {Function} sendResponse - 응답 함수
   */
  function handleClearCacheMessage(sendResponse) {
    chrome.storage.local.get(null, (items) => {
      const cachePrefix = APP_CONFIG.cacheSettings.keyPrefix;
      const cacheKeys = Object.keys(items).filter(key => 
        key.startsWith(cachePrefix)
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
  }
  
  /**
   * 스크립트 로드 메시지 처리
   * @param {Array} scripts - 로드할 스크립트 배열
   * @param {Object} tab - 탭 정보
   * @param {Function} sendResponse - 응답 함수
   */
  function handleLoadScriptsMessage(scripts, tab, sendResponse) {
    if (!Array.isArray(scripts) || scripts.length === 0) {
      sendResponse({ success: false, error: "유효한 스크립트 목록이 필요합니다" });
      return;
    }
    
    if (!tab || !tab.id) {
      sendResponse({ success: false, error: "탭 정보 없음" });
      return;
    }
    
    console.log(`[${APP_CONFIG.appName}] 누락된 모듈 로드 요청 수신:`, scripts);
    
    const tabId = tab.id;
    const loadPromises = [];
    
    // 각 스크립트 로드 요청을 병렬로 처리
    scripts.forEach(script => {
      const loadPromise = chrome.scripting.executeScript({
        target: { tabId },
        files: [script]
      })
      .then(() => {
        console.log(`[${APP_CONFIG.appName}] ${script} 수동 로드 성공`);
        return { script, success: true };
      })
      .catch(error => {
        console.error(`[${APP_CONFIG.appName}] ${script} 수동 로드 실패:`, error);
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
  }
  
  /**
   * 컨텍스트 메뉴 생성
   */
  function setupContextMenu() {
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
    
    // 컨텍스트 메뉴 클릭 이벤트 처리
    chrome.contextMenus.onClicked.addListener((info, tab) => {
      if (info.menuItemId === APP_CONFIG.menuItemId && tab && tab.id) {
        console.log(`[${APP_CONFIG.appName}] 우클릭 메뉴가 클릭됨, content-script 실행...`);
        loadContentScriptsAndTranslate(tab.id);
      }
    });
  }
  
  /**
   * 월간 사용량 리셋 설정
   */
  function setupMonthlyReset() {
    // 매일 자정에 체크 (24시간마다)
    chrome.alarms.create('checkMonthlyReset', { periodInMinutes: 60 * 24 });
    
    chrome.alarms.onAlarm.addListener(async (alarm) => {
      if (alarm.name === 'checkMonthlyReset') {
        checkAndResetMonthlyUsage();
      }
    });
    
    console.log(`[${APP_CONFIG.appName}] 월간 사용량 리셋 체크 알람 설정됨`);
  }
  
  /**
   * 월간 사용량 확인 및 리셋
   */
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
        console.log(`[${APP_CONFIG.appName}] 월간 사용량 리셋 완료`);
      }
    });
  }
  
  /**
   * 콘텐츠 스크립트 로드 및 메시지 전송
   * @param {number} tabId - 탭 ID
   */
  function loadContentScriptsAndTranslate(tabId) {
    // 스크립트를 순차적으로 로드
    const loadScriptSequentially = (index = 0) => {
      if (index >= APP_CONFIG.contentScripts.length) {
        // 모든 스크립트 로드 완료 후 번역 요청
        console.log(`[${APP_CONFIG.appName}] 모든 스크립트 로드 완료, 번역 요청 전송`);
        chrome.tabs.sendMessage(tabId, { action: "translatePage" })
          .catch(err => console.error(`[${APP_CONFIG.appName}] 번역 요청 전송 오류:`, err));
        return;
      }
      
      console.log(`[${APP_CONFIG.appName}] ${APP_CONFIG.contentScripts[index]} 로드 중...`);
      
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: [APP_CONFIG.contentScripts[index]]
      }).then(() => {
        console.log(`[${APP_CONFIG.appName}] ${APP_CONFIG.contentScripts[index]} 로드 성공`);
        // 다음 스크립트 로드
        loadScriptSequentially(index + 1);
      }).catch((err) => {
        console.error(`[${APP_CONFIG.appName}] ${APP_CONFIG.contentScripts[index]} 로드 실패:`, err);
        
        // 핵심 모듈 로드 실패 시 중단
        if (index <= 2) {  // config.js, cache-manager.js, usage-manager.js는 필수
          console.error(`[${APP_CONFIG.appName}] 핵심 모듈 로드 실패로 번역을 중단합니다.`);
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
          console.log(`[${APP_CONFIG.appName}] 콘텐츠 스크립트가 이미 로드됨`);
          chrome.tabs.sendMessage(tabId, { action: "translatePage" });
        } else {
          // 순차적으로 스크립트 로드 시작
          loadScriptSequentially();
        }
      })
      .catch(error => {
        console.log(`[${APP_CONFIG.appName}] 콘텐츠 스크립트 확인 실패, 새로 로드합니다:`, error);
        // 순차적으로 스크립트 로드 시작
        loadScriptSequentially();
      });
  }
  
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
              console.warn(`[${APP_CONFIG.appName}] 탭 ${tab.id} 메시지 전송 오류:`, err);
            }
          });
        } catch (err) {
          // 오류 무시 (content-script가 로드되지 않은 탭)
        }
      });
    });
  }
})();