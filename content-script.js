// content-script.js - ES Module 방식 (전역변수 최소화)
'use strict';

import { 
  APP_CONFIG, 
  safeDispatchEvent, 
  createSafeEventListener, 
  isExtensionContextValid,
  areModulesLoaded,
  importModule
} from './config.js';

// 모듈 스코프에서 상태 관리 (window 전역변수 사용 대신)
// 초기화 여부 플래그
let isInitialized = false;

// 로드된 모듈을 저장할 객체
const Modules = {};

// 애플리케이션 상태 관리
const AppState = {
  isTranslating: false,
  settings: null,
  pendingTranslation: false,
  
  /**
   * 상태 초기화
   * @param {Object} domHandler - DOMHandler 모듈
   */
  reset(domHandler) {
    this.isTranslating = false;
    this.pendingTranslation = false;
    
    if (domHandler && typeof domHandler.resetTranslationState === 'function') {
      try {
        domHandler.resetTranslationState();
      } catch (error) {
        console.error(`[${APP_CONFIG.appName}] 상태 초기화 오류:`, error);
      }
    }
  }
};

// 오류 처리를 위한 이벤트 리스너
document.addEventListener('error', function(event) {
  console.error(`[${APP_CONFIG.appName}] 문서 오류 발생:`, event.error);
});

// 즉시 실행 함수로 초기화 시작
(async function() {
  // 이미 초기화된 경우 중복 실행 방지
  if (isInitialized) {
    console.log(`[${APP_CONFIG.appName}] 이미 초기화되어 중복 실행 방지`);
    return;
  }
  
  try {
    // 번역기 초기화 실행
    await initializeTranslator();
  } catch (error) {
    console.error(`[${APP_CONFIG.appName}] 초기화 실패:`, error);
  }
})();

/**
 * 필요한 모듈 로드하기
 * @param {number} maxAttempts - 최대 시도 횟수
 * @param {number} delay - 재시도 간격 (ms)
 * @returns {Promise<boolean>} - 모듈 로드 성공 여부
 */
async function loadModules(maxAttempts = 10, delay = 200) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    
    // 필요한 모듈 목록
    const requiredModules = [
      'DOMSelector', 'DOMObserver', 'DOMManipulator', 'BatchEngine',
      'TranslatorService', 'CacheManager', 'UsageManager', 'UIManager', 'DOMHandler'
    ];
    
    async function tryLoadModules() {
      // 모듈 상태 출력 (모든 시도에서)
      if (attempts > 0) {
        console.log(`[${APP_CONFIG.appName}] 모듈 로드 상태 확인 (#${attempts}):`);
        logModuleStatus();
      }
      
      // 모듈 로드 시도
      for (const [moduleName, modulePath] of Object.entries(APP_CONFIG.moduleImports)) {
        if (!Modules[moduleName]) {
          try {
            const moduleExports = await importModule(modulePath);
            Modules[moduleName] = moduleExports;
            console.log(`[${APP_CONFIG.appName}] 모듈 로드됨: ${moduleName}`);
          } catch (error) {
            console.error(`[${APP_CONFIG.appName}] 모듈 로드 실패: ${moduleName}`, error);
          }
        }
      }
      
      // 모든 모듈이 로드되었는지 확인
      const allModulesLoaded = areModulesLoaded(requiredModules, Modules);
      
      if (allModulesLoaded) {
        console.log(`[${APP_CONFIG.appName}] 모든 모듈이 정상적으로 로드되었습니다!`);
        resolve(true);
        return;
      }
      
      attempts++;
      if (attempts >= maxAttempts) {
        console.error(`[${APP_CONFIG.appName}] 필요한 모듈이 로드되지 않았습니다. 로드 순서를 확인하세요.`);
        
        // 누락된 모듈 목록 생성
        const missingModules = getMissingModules(requiredModules);
        
        // 마지막 시도: 누락된 모듈 로드 요청
        if (missingModules.length > 0 && isExtensionContextValid()) {
          console.log(`[${APP_CONFIG.appName}] 누락된 모듈 로드 시도:`, missingModules);
          
          try {
            chrome.runtime.sendMessage({ 
              action: "loadScripts", 
              scripts: missingModules
            }, (response) => {
              console.log(`[${APP_CONFIG.appName}] 모듈 로드 요청 응답:`, response);
              // 추가 대기 후 다시 한번 체크 시도
              setTimeout(() => {
                if (areModulesLoaded(requiredModules, Modules)) {
                  console.log(`[${APP_CONFIG.appName}] 모듈 수동 로드 성공!`);
                  resolve(true);
                } else {
                  reject(new Error("모듈 로드 실패"));
                }
              }, 1000);
            });
            return; // 추가 시간 제공을 위해 즉시 반환
          } catch (e) {
            console.error(`[${APP_CONFIG.appName}] 모듈 로드 요청 오류:`, e);
          }
        }
        
        reject(new Error("모듈 로드 실패"));
        return;
      }
      
      // 다시 시도
      setTimeout(tryLoadModules, delay);
    }
    
    tryLoadModules();
  });
}

/**
 * 모듈 상태 출력 함수
 */
function logModuleStatus() {
  const modules = [
    'DOMHandler', 'TranslatorService', 'CacheManager', 'UsageManager',
    'UIManager', 'DOMSelector', 'DOMObserver', 'DOMManipulator', 'BatchEngine'
  ];
  
  modules.forEach(moduleName => {
    const status = Modules[moduleName] ? "로드됨" : "누락";
    console.log(`- ${moduleName}: ${status}`);
  });
}

/**
 * 누락된 모듈 파일 경로 목록 가져오기
 * @param {string[]} requiredModules - 필요한 모듈 이름 배열
 * @returns {string[]} - 누락된 모듈 파일 경로 배열
 */
function getMissingModules(requiredModules) {
  return requiredModules
    .filter(moduleName => !Modules[moduleName])
    .map(moduleName => APP_CONFIG.moduleImports[moduleName])
    .filter(Boolean);
}

/**
 * 텍스트 노드 처리
 * @param {Array} nodeInfoList - 텍스트 노드 정보 배열
 * @param {Array} elements - 번역 대상 요소 배열
 * @returns {Promise<number>} - 번역된 텍스트 수
 */
async function processTextNodes(nodeInfoList, elements) {
  // 입력 검증
  if (!nodeInfoList || !Array.isArray(nodeInfoList) || nodeInfoList.length === 0) {
    console.warn(`[${APP_CONFIG.appName}] 유효하지 않은 노드 정보 목록:`, nodeInfoList);
    return 0;
  }
  
  // 이미 번역 중이면 대기
  if (AppState.pendingTranslation) {
    console.log(`[${APP_CONFIG.appName}] 이미 번역 작업이 대기 중입니다.`);
    return 0;
  }
  
  // 모듈 유효성 검사
  if (!Modules.TranslatorService || !Modules.DOMHandler) {
    console.error(`[${APP_CONFIG.appName}] 필수 번역 모듈이 없습니다.`);
    return 0;
  }
  
  AppState.pendingTranslation = true;
  
  try {
    // 텍스트 배열 추출
    const textsToTranslate = nodeInfoList.map(item => item.text || "");
    
    // 번역 이벤트 리스너 등록 (안전한 버전)
    const batchCompleteListener = createSafeEventListener('translation:batch-complete', 
      (event, detail) => {
        if (detail) {
          const total = detail.total || 0;
          const completed = detail.completed || 0;
          const cachedCount = detail.cachedCount || 0;
          const newCount = detail.newCount || 0;
          
          if (Modules.UIManager && typeof Modules.UIManager.showTranslationStatus === 'function') {
            Modules.UIManager.showTranslationStatus(
              `${total}개 항목 번역 중... (${completed}/${total} 배치, 캐시: ${cachedCount}, 신규: ${newCount})`
            );
          }
        }
      }
    );
    
    // 이벤트 리스너 등록
    document.addEventListener('translation:batch-complete', batchCompleteListener);
    
    // 배치 처리를 통한 번역
    const translatedItems = await Modules.TranslatorService.translateInBatches(
      textsToTranslate, 
      (AppState.settings && AppState.settings.batchSize) || APP_CONFIG.defaultSettings.batchSize, 
      (AppState.settings && AppState.settings.maxConcurrentBatches) || APP_CONFIG.defaultSettings.maxConcurrentBatches
    );
    
    // 이벤트 리스너 제거
    document.removeEventListener('translation:batch-complete', batchCompleteListener);
    
    // 번역 결과가 없으면 종료
    if (!translatedItems || !Array.isArray(translatedItems)) {
      console.warn(`[${APP_CONFIG.appName}] 번역 결과가 없습니다.`);
      AppState.pendingTranslation = false;
      return 0;
    }
    
    // 번역 결과를 DOM에 적용하기 위한 형식으로 변환
    const translationDataForDOM = translatedItems.map((item, index) => {
      // 인덱스가 범위를 벗어나면 빈 객체 반환
      if (!nodeInfoList[index]) return { original: "", translated: "", xpath: "" };
      
      return {
        original: item.original || "",
        translated: item.translated || "",
        xpath: nodeInfoList[index].xpath || ""
      };
    }).filter(item => item.xpath); // 빈 xpath 항목 제거
    
    // 번역된 텍스트 DOM에 적용
    const replacedCount = Modules.DOMHandler.replaceTextsInDOM(
      translationDataForDOM, 
      Array.isArray(elements) ? elements : []
    );
    
    AppState.pendingTranslation = false;
    
    return replacedCount;
  } catch (error) {
    console.error(`[${APP_CONFIG.appName}] 텍스트 노드 처리 오류:`, error);
    AppState.pendingTranslation = false;
    return 0;
  }
}

/**
 * 이벤트 리스너 설정
 */
function setupEventListeners() {
  // 텍스트 노드 준비됨 이벤트 리스너
  document.addEventListener('dom:textnodes-ready', createSafeEventListener(
    'dom:textnodes-ready',
    (event, detail) => {
      const nodes = detail.nodes || [];
      const elements = detail.elements || [];
      
      if (nodes.length > 0) {
        processTextNodes(nodes, elements).catch(error => {
          console.error(`[${APP_CONFIG.appName}] 노드 처리 오류:`, error);
        });
      } else {
        console.warn(`[${APP_CONFIG.appName}] 텍스트 노드 이벤트에 노드가 없습니다.`);
      }
    }
  ));
  
  // 번역 한도 초과 이벤트 리스너
  document.addEventListener('usage:limit-exceeded', createSafeEventListener(
    'usage:limit-exceeded',
    () => {
      if (Modules.UIManager && typeof Modules.UIManager.showTranslationLimitExceeded === 'function') {
        Modules.UIManager.showTranslationLimitExceeded(() => {
          if (isExtensionContextValid()) {
            chrome.runtime.sendMessage({ action: "openPopup" });
          }
        });
      }
    }
  ));
  
  // DOM 관련 이벤트 리스너
  document.addEventListener('dom:translating-state-changed', createSafeEventListener(
    'dom:translating-state-changed',
    (event, detail) => {
      AppState.isTranslating = detail.isTranslating === true;
    }
  ));
  
  // 번역 완료 이벤트 리스너
  document.addEventListener('dom:text-replaced', createSafeEventListener(
    'dom:text-replaced',
    (event, detail) => {
      const count = detail.count || 0;
      console.log(`[${APP_CONFIG.appName}] ${count}개 텍스트 교체됨`);
    }
  ));
}

/**
 * 설정 로드
 * @returns {Promise<Object>} - 설정 객체
 */
async function loadSettings() {
  return new Promise((resolve) => {
    if (!isExtensionContextValid()) {
      // 컨텍스트가 무효화된 경우 기본 설정 사용
      const defaultSettings = APP_CONFIG.defaultSettings;
      AppState.settings = defaultSettings;
      applySettings(defaultSettings);
      resolve(defaultSettings);
      return;
    }
    
    try {
      chrome.storage.sync.get('settings', (data) => {
        try {
          // 기본 설정
          const defaultSettings = APP_CONFIG.defaultSettings;
          
          // 사용자 설정과 기본 설정 병합
          const settings = data && data.settings ? { ...defaultSettings, ...data.settings } : defaultSettings;
          
          // 설정 적용
          applySettings(settings);
          
          AppState.settings = settings;
          resolve(settings);
        } catch (innerError) {
          console.error(`[${APP_CONFIG.appName}] 설정 처리 오류:`, innerError);
          
          // 오류 시 기본 설정 사용
          const defaultSettings = APP_CONFIG.defaultSettings;
          AppState.settings = defaultSettings;
          applySettings(defaultSettings);
          resolve(defaultSettings);
        }
      });
    } catch (error) {
      console.error(`[${APP_CONFIG.appName}] 설정 로드 오류:`, error);
      
      // 오류 시 기본 설정 사용
      const defaultSettings = APP_CONFIG.defaultSettings;
      AppState.settings = defaultSettings;
      applySettings(defaultSettings);
      resolve(defaultSettings);
    }
  });
}

/**
 * 설정 각 모듈에 적용
 * @param {Object} settings - 적용할 설정
 */
function applySettings(settings) {
  if (!settings) return;
  
  // TranslatorService 설정 적용
  if (Modules.TranslatorService && typeof Modules.TranslatorService.updateSettings === 'function') {
    try {
      Modules.TranslatorService.updateSettings({ 
        targetLang: settings.targetLang,
        workerEndpoint: APP_CONFIG.apiEndpoint
      });
    } catch (error) {
      console.error(`[${APP_CONFIG.appName}] TranslatorService 설정 오류:`, error);
    }
  }
  
  // DOMHandler 설정 적용
  if (Modules.DOMHandler && typeof Modules.DOMHandler.updateSettings === 'function') {
    try {
      Modules.DOMHandler.updateSettings({
        minTextLength: settings.minTextLength,
        translateFullPage: settings.translateFullPage,
        immediateTranslation: settings.immediateTranslation
      });
    } catch (error) {
      console.error(`[${APP_CONFIG.appName}] DOMHandler 설정 오류:`, error);
    }
  }
  
  // CacheManager 설정 적용
  if (Modules.CacheManager && typeof Modules.CacheManager.updateSettings === 'function') {
    try {
      Modules.CacheManager.updateSettings(APP_CONFIG.cacheSettings);
    } catch (error) {
      console.error(`[${APP_CONFIG.appName}] CacheManager 설정 오류:`, error);
    }
  }
  
  // UIManager 설정 적용
  if (Modules.UIManager && typeof Modules.UIManager.updateSettings === 'function') {
    try {
      Modules.UIManager.updateSettings(APP_CONFIG.uiSettings);
    } catch (error) {
      console.error(`[${APP_CONFIG.appName}] UIManager 설정 오류:`, error);
    }
  }
}

/**
 * 웹페이지 번역 프로세스
 * @returns {Promise<string>} - 번역 결과 메시지
 */
async function translatePage() {
  console.log(`[${APP_CONFIG.appName}] 페이지 번역 시작`);
  
  // 이미 번역 중이면 중복 실행 방지
  if (AppState.isTranslating) {
    return "이미 번역 중입니다.";
  }
  
  // 컨텍스트 확인
  if (!isExtensionContextValid()) {
    console.warn(`[${APP_CONFIG.appName}] 확장 프로그램 컨텍스트가 무효화됨`);
    return "확장 프로그램 컨텍스트 오류. 페이지를 새로고침 해주세요.";
  }
  
  // 필수 모듈 확인
  if (!Modules.DOMHandler || !Modules.UIManager) {
    console.error(`[${APP_CONFIG.appName}] 필수 모듈이 로드되지 않음`);
    return "필수 모듈이 로드되지 않았습니다.";
  }
  
  // 번역 상태 설정
  AppState.isTranslating = true;
  Modules.DOMHandler.setTranslatingState(true);
  
  // 번역 진행 상태 표시
  Modules.UIManager.showTranslationStatus("번역 준비 중...");
  
  try {
    // 설정 로드 (필요시)
    if (!AppState.settings) {
      await loadSettings();
    }
    
    // 기존 번역 상태 초기화
    Modules.DOMHandler.resetTranslationState();
    
    // IntersectionObserver 기반 번역 시스템 초기화
    Modules.DOMHandler.initialize();
    
    Modules.UIManager.showTranslationStatus("번역 진행 중...");
    
    // 완료 메시지 표시 (IntersectionObserver가 비동기적으로 번역 시작)
    setTimeout(() => {
      if (AppState.isTranslating) {
        Modules.UIManager.showTranslationStatus("페이지 스크롤 시 추가 콘텐츠가 자동으로 번역됩니다.", true);
        
        // 일정 시간 후 상태 메시지 숨기기
        setTimeout(() => {
          Modules.UIManager.hideTranslationStatus();
          
          // 번역 상태 업데이트
          AppState.isTranslating = false;
          Modules.DOMHandler.setTranslatingState(false);
        }, APP_CONFIG.uiSettings.autoHideDelay);
      }
    }, 1000);
    
    return "번역이 시작되었습니다. 페이지 스크롤 시 추가 콘텐츠가 자동으로 번역됩니다.";
  } catch (error) {
    console.error(`[${APP_CONFIG.appName}] 번역 오류:`, error);
    try {
      Modules.UIManager.hideTranslationStatus();
    } catch (e) {}
    
    AppState.isTranslating = false;
    try {
      Modules.DOMHandler.setTranslatingState(false);
    } catch (e) {}
    
    return `번역 오류: ${error.message || '알 수 없는 오류'}`;
  }
}

/**
 * 크롬 메시지 리스너 설정
 */
function setupMessageListeners() {
  // 컨텍스트가 유효하지 않으면 실행하지 않음
  if (!isExtensionContextValid()) return;
  
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    try {
      switch (request.action) {
        case "ping":
          // 페이지에 로드되었는지 확인용
          sendResponse({ status: "ready" });
          return true;
          
        case "translatePage":
          // 페이지 번역 요청
          translatePage().then(result => {
            if (isExtensionContextValid()) {
              sendResponse({ success: true, result });
            }
          }).catch(error => {
            console.error(`[${APP_CONFIG.appName}] 오류:`, error);
            if (isExtensionContextValid()) {
              sendResponse({ success: false, error: error.message || '알 수 없는 오류' });
            }
          });
          return true; // 비동기 응답을 위해 true 반환
          
        case "updateSettings":
          // 설정 업데이트
          loadSettings().then(() => {
            // 설정 변경 후 번역 시스템 재초기화
            if (document.body && Modules.DOMHandler) {
              Modules.DOMHandler.resetTranslationState();
              Modules.DOMHandler.initialize();
            }
            
            if (isExtensionContextValid()) {
              sendResponse({ success: true });
            }
          }).catch(error => {
            console.error(`[${APP_CONFIG.appName}] 설정 업데이트 오류:`, error);
            if (isExtensionContextValid()) {
              sendResponse({ success: false, error: error.message || '알 수 없는 오류' });
            }
          });
          return true;
          
        default:
          // 알 수 없는 메시지는 무시
          return false;
      }
    } catch (error) {
      console.error(`[${APP_CONFIG.appName}] 메시지 처리 오류:`, error);
      // 컨텍스트가 여전히 유효하면 응답 시도
      if (isExtensionContextValid()) {
        sendResponse({ success: false, error: error.message || '알 수 없는 오류' });
      }
      return true;
    }
  });
}

/**
 * 페이지 로드 완료 시 자동 번역 설정
 */
function setupAutoTranslate() {
  try {
    const autoTranslateHandler = () => {
      // 설정 로드
      loadSettings().then(settings => {
        if (settings && settings.autoTranslate) {
          translatePage().catch(error => {
            console.error(`[${APP_CONFIG.appName}] 자동 번역 오류:`, error);
          });
        }
      }).catch(error => {
        console.error(`[${APP_CONFIG.appName}] 설정 로드 오류:`, error);
      });
    };
    
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', autoTranslateHandler);
    } else {
      // 이미 DOM이 로드된 경우
      autoTranslateHandler();
    }
    
    // 주기적으로 오래된 캐시 정리
    setTimeout(() => {
      try {
        if (Modules.CacheManager && typeof Modules.CacheManager.cleanupExpired === 'function') {
          Modules.CacheManager.cleanupExpired();
        }
      } catch (error) {
        console.error(`[${APP_CONFIG.appName}] 캐시 정리 오류:`, error);
      }
    }, 10000);
  } catch (error) {
    console.error(`[${APP_CONFIG.appName}] 자동 번역 설정 오류:`, error);
  }
}

/**
 * 번역 확장 초기화 메인 함수
 */
async function initializeTranslator() {
  try {
    console.log(`[${APP_CONFIG.appName}] 초기화 시작`);
    
    // 모듈 로드 확인 (비동기적으로 대기)
    await loadModules();
    
    // 초기화 표시 - 플래그 설정
    isInitialized = true;
    
    // 이벤트 리스너 설정
    setupEventListeners();
    
    // 크롬 메시지 리스너 설정 (확장 프로그램 컨텍스트가 유효한 경우에만)
    if (isExtensionContextValid()) {
      setupMessageListeners();
    }
    
    // 설정 로드
    await loadSettings();
    
    // 자동 번역 설정
    setupAutoTranslate();
    
    // 페이지 언로드 시 리소스 정리
    document.addEventListener('beforeunload', () => {
      try {
        if (Modules.DOMHandler && typeof Modules.DOMHandler.cleanup === 'function') {
          Modules.DOMHandler.cleanup();
        }
      } catch (error) {
        console.error(`[${APP_CONFIG.appName}] 리소스 정리 오류:`, error);
      }
    });
    
    // 필요한 API를 제공하는 객체 생성 (window 전역으로 노출하지 않음)
    const translatorAPI = {
      translatePage,
      getSettings: () => AppState.settings
    };
    
    // 외부 스크립트에서 접근해야 하는 경우만 노출
    // 대신 메시지 통신으로 대체하는 것을 권장
    if (isExtensionContextValid()) {
      // 디버깅/테스트용으로만 제한적 노출
      Object.defineProperty(window, '__tonyTranslator', {
        value: translatorAPI,
        writable: false,
        configurable: false
      });
    }
    
    console.log(`[${APP_CONFIG.appName}] 초기화 완료`);
    return translatorAPI;
  } catch (error) {
    console.error(`[${APP_CONFIG.appName}] 초기화 실패:`, error);
    throw error;
  }
}

// 번역 API 외부 노출 (ES 모듈 방식)
export {
  translatePage,
  AppState,
  Modules,
  isInitialized
};