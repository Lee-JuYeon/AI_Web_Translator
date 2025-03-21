// background.js - ES 모듈 방식
'use strict';

import { 
  APP_CONFIG, 
  compareVersions, 
  getBrowserLanguage, 
  getCurrentMonth,
  safeDispatchEvent
} from './config.js';

// 필요한 모듈들 임포트
import * as CacheManager from './utils/cache-manager.js';
import * as UsageManager from './utils/usage-manager.js';
import * as UIManager from './utils/ui-manager.js';
import * as TranslatorService from './utils/translator-service.js';
import * as DOMSelector from './utils/dom/dom-selector.js';
import * as DOMObserver from './utils/dom/dom-observer.js';
import * as DOMManipulator from './utils/dom/dom-manipulator.js';
import * as DOMHandler from './utils/dom/dom-handler.js';
import * as BatchEngine from './utils/batch/batch_engine.js';

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
    
    // 콘텐츠 스크립트로부터 텍스트 노드 처리 요청 처리
    case 'processTextNodes':
      handleProcessTextNodesMessage(message.nodeInfoList, message.elements, sendResponse);
      return true; // 비동기 응답
      
    // 설정 요청 처리
    case 'getSettings':
      handleGetSettingsMessage(sendResponse);
      return true; // 비동기 응답
      
    // 텍스트 번역 요청 처리
    case 'translateText':
      handleTranslateTextMessage(message.text, message.options, sendResponse);
      return true; // 비동기 응답
      
    // 배치 텍스트 번역 요청 처리
    case 'translateTexts':
      handleTranslateTextsMessage(message.texts, message.options, sendResponse);
      return true; // 비동기 응답
    
    // 모듈 API 함수 호출 처리
    case 'callModuleFunction':
      handleModuleFunctionCall(message.module, message.function, message.params, sendResponse);
      return true; // 비동기 응답
      
    default:
      console.warn(`[${APP_CONFIG.appName}] 알 수 없는 메시지: ${message.action}`);
      return false;
  }
}

/**
 * 텍스트 노드 처리 메시지 처리
 * @param {Array} nodeInfoList - 텍스트 노드 정보 배열
 * @param {Array} elements - 번역 대상 요소 배열
 * @param {Function} sendResponse - 응답 함수
 */
async function handleProcessTextNodesMessage(nodeInfoList, elements, sendResponse) {
  try {
    // 입력 검증
    if (!nodeInfoList || !Array.isArray(nodeInfoList) || nodeInfoList.length === 0) {
      sendResponse({ success: false, error: "유효하지 않은 노드 정보 목록" });
      return;
    }
    
    // 텍스트 배열 추출
    const textsToTranslate = nodeInfoList.map(item => item.text || "");
    
    // 사용량 확인 (제한 초과 시 오류 반환)
    if (UsageManager) {
      const estimatedTokens = UsageManager.estimateTokens(textsToTranslate);
      const canTranslate = await UsageManager.canTranslate(estimatedTokens);
      
      if (!canTranslate) {
        sendResponse({ 
          success: false, 
          error: "번역 한도 초과", 
          limitExceeded: true 
        });
        return;
      }
    }
    
    // 배치 처리를 통한 번역
    const translatedItems = await TranslatorService.translateInBatches(
      textsToTranslate, 
      APP_CONFIG.defaultSettings.batchSize, 
      APP_CONFIG.defaultSettings.maxConcurrentBatches
    );
    
    // 번역 결과가 없으면 오류
    if (!translatedItems || !Array.isArray(translatedItems)) {
      sendResponse({ success: false, error: "번역 결과가 없습니다" });
      return;
    }
    
    // 응답
    sendResponse({
      success: true,
      results: translatedItems
    });
    
    // 사용량 기록
    if (UsageManager) {
      const tokensUsed = UsageManager.estimateTokens(textsToTranslate);
      await UsageManager.recordUsage(tokensUsed);
    }
  } catch (error) {
    console.error(`[${APP_CONFIG.appName}] 텍스트 노드 처리 오류:`, error);
    sendResponse({ success: false, error: error.message || "텍스트 노드 처리 오류" });
  }
}

/**
 * 설정 얻기 메시지 처리
 * @param {Function} sendResponse - 응답 함수
 */
function handleGetSettingsMessage(sendResponse) {
  chrome.storage.sync.get('settings', (data) => {
    const defaultSettings = APP_CONFIG.defaultSettings;
    const settings = data.settings || defaultSettings;
    
    sendResponse({
      success: true,
      settings: settings
    });
  });
}

/**
 * 텍스트 번역 메시지 처리
 * @param {string} text - 번역할 텍스트
 * @param {Object} options - 번역 옵션
 * @param {Function} sendResponse - 응답 함수
 */
async function handleTranslateTextMessage(text, options, sendResponse) {
  try {
    if (!text) {
      sendResponse({ success: false, error: "번역할 텍스트가 없습니다" });
      return;
    }
    
    const translatedText = await TranslatorService.translateText(text, options);
    
    sendResponse({
      success: true,
      result: translatedText
    });
  } catch (error) {
    console.error(`[${APP_CONFIG.appName}] 텍스트 번역 오류:`, error);
    sendResponse({ success: false, error: error.message || "텍스트 번역 오류" });
  }
}

/**
 * 배치 텍스트 번역 메시지 처리
 * @param {Array} texts - 번역할 텍스트 배열
 * @param {Object} options - 번역 옵션
 * @param {Function} sendResponse - 응답 함수
 */
async function handleTranslateTextsMessage(texts, options, sendResponse) {
  try {
    if (!texts || !Array.isArray(texts) || texts.length === 0) {
      sendResponse({ success: false, error: "번역할 텍스트가 없습니다" });
      return;
    }
    
    const translatedTexts = await TranslatorService.translateTexts(texts, options);
    
    sendResponse({
      success: true,
      results: translatedTexts
    });
  } catch (error) {
    console.error(`[${APP_CONFIG.appName}] 배치 텍스트 번역 오류:`, error);
    sendResponse({ success: false, error: error.message || "배치 텍스트 번역 오류" });
  }
}

/**
 * 모듈 함수 호출 처리
 * @param {string} moduleName - 모듈 이름
 * @param {string} functionName - 함수 이름
 * @param {Array} params - 함수 파라미터
 * @param {Function} sendResponse - 응답 함수
 */
async function handleModuleFunctionCall(moduleName, functionName, params, sendResponse) {
  try {
    // 모듈 찾기
    let targetModule;
    
    switch(moduleName) {
      case 'CacheManager':
        targetModule = CacheManager;
        break;
      case 'UsageManager':
        targetModule = UsageManager;
        break;
      case 'UIManager':
        targetModule = UIManager;
        break;
      case 'TranslatorService':
        targetModule = TranslatorService;
        break;
      case 'DOMSelector':
        targetModule = DOMSelector;
        break;
      case 'DOMObserver':
        targetModule = DOMObserver;
        break;
      case 'DOMManipulator':
        targetModule = DOMManipulator;
        break;
      case 'DOMHandler':
        targetModule = DOMHandler;
        break;
      case 'BatchEngine':
        targetModule = BatchEngine;
        break;
      default:
        sendResponse({ success: false, error: `알 수 없는 모듈: ${moduleName}` });
        return;
    }
    
    // 함수 존재 확인
    if (!targetModule || typeof targetModule[functionName] !== 'function') {
      sendResponse({ success: false, error: `${moduleName} 모듈에 ${functionName} 함수가 없습니다` });
      return;
    }
    
    // 함수 실행
    const result = await targetModule[functionName](...(params || []));
    
    // 응답
    sendResponse({
      success: true,
      result: result
    });
  } catch (error) {
    console.error(`[${APP_CONFIG.appName}] 모듈 함수 호출 오류:`, error);
    sendResponse({ success: false, error: error.message || "모듈 함수 호출 오류" });
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
    
    const subscriptionLimits = APP_CONFIG.subscriptionLimits;
    
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
  // 콘텐츠 스크립트만 로드
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    files: ['content-script.js']
  }).then(() => {
    console.log(`[${APP_CONFIG.appName}] 콘텐츠 스크립트 로드 성공`);
    
    // 모듈 로드 후 번역 요청
    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, { action: "translatePage" })
        .catch(err => console.error(`[${APP_CONFIG.appName}] 번역 요청 전송 오류:`, err));
    }, 500); // 약간의 지연 추가
  }).catch((err) => {
    console.error(`[${APP_CONFIG.appName}] 콘텐츠 스크립트 로드 실패:`, err);
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