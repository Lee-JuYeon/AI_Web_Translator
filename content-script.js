// content-script.js - TonyConfig 활용 리팩토링 버전
(function() {
  'use strict';
  
  // 모듈 전역 에러 처리 추가
  window.addEventListener('error', function(event) {
    console.error(`[${TonyConfig.APP_CONFIG.appName}] 전역 오류 발생:`, event.error);
  });
  
  // 초기화 플래그 확인
  if (window.tonyTranslatorInitialized) {
    console.log(`[${TonyConfig.APP_CONFIG.appName}] 이미 초기화되어 중복 실행 방지`);
    return;
  }
  
  // 애플리케이션 상태 관리
  const AppState = {
    isTranslating: false,
    settings: null,
    pendingTranslation: false,
    
    /**
     * 상태 초기화
     */
    reset() {
      this.isTranslating = false;
      this.pendingTranslation = false;
      
      if (window.DOMHandler && typeof window.DOMHandler.resetTranslationState === 'function') {
        try {
          window.DOMHandler.resetTranslationState();
        } catch (error) {
          console.error(`[${TonyConfig.APP_CONFIG.appName}] 상태 초기화 오류:`, error);
        }
      }
    }
  };
  
  /**
   * 필요한 모듈이 모두 로드되었는지 확인
   * @param {number} maxAttempts - 최대 시도 횟수
   * @param {number} delay - 재시도 간격 (ms)
   * @returns {Promise<boolean>} - 모듈 로드 여부
   */
  async function ensureModulesLoaded(maxAttempts = 10, delay = 200) {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      
      // 필요한 모듈 목록
      const requiredModules = [
        'DOMSelector', 'DOMObserver', 'DOMManipulator', 'BatchEngine',
        'TranslatorService', 'CacheManager', 'UsageManager', 'UIManager', 'DOMHandler'
      ];
      
      function checkModules() {
        // 모듈 상태 출력 (모든 시도에서)
        if (attempts > 0) {
          console.log(`[${TonyConfig.APP_CONFIG.appName}] 모듈 로드 상태 확인 (#${attempts}):`);
          checkModuleStatus();
        }
        
        // 모든 모듈이 로드되었는지 확인
        const allModulesLoaded = TonyConfig.areModulesLoaded(requiredModules);
        
        if (allModulesLoaded) {
          console.log(`[${TonyConfig.APP_CONFIG.appName}] 모든 모듈이 정상적으로 로드되었습니다!`);
          resolve(true);
          return;
        }
        
        attempts++;
        if (attempts >= maxAttempts) {
          console.error(`[${TonyConfig.APP_CONFIG.appName}] 필요한 모듈이 로드되지 않았습니다. 로드 순서를 확인하세요.`);
          
          // 누락된 모듈 목록 생성
          const missingModules = getMissingModules(requiredModules);
          
          // 마지막 시도: 누락된 모듈 로드 요청
          if (missingModules.length > 0 && TonyConfig.isExtensionContextValid()) {
            console.log(`[${TonyConfig.APP_CONFIG.appName}] 누락된 모듈 로드 시도:`, missingModules);
            
            try {
              chrome.runtime.sendMessage({ 
                action: "loadScripts", 
                scripts: missingModules
              }, (response) => {
                console.log(`[${TonyConfig.APP_CONFIG.appName}] 모듈 로드 요청 응답:`, response);
                // 추가 대기 후 다시 한번 체크 시도
                setTimeout(() => {
                  if (TonyConfig.areModulesLoaded(requiredModules)) {
                    console.log(`[${TonyConfig.APP_CONFIG.appName}] 모듈 수동 로드 성공!`);
                    resolve(true);
                  } else {
                    reject(new Error("모듈 로드 실패"));
                  }
                }, 1000);
              });
              return; // 추가 시간 제공을 위해 즉시 반환
            } catch (e) {
              console.error(`[${TonyConfig.APP_CONFIG.appName}] 모듈 로드 요청 오류:`, e);
            }
          }
          
          reject(new Error("모듈 로드 실패"));
          return;
        }
        
        // 다시 시도
        setTimeout(checkModules, delay);
      }
      
      checkModules();
    });
  }
  
  /**
   * 모듈 상태 확인 및 출력
   */
  function checkModuleStatus() {
    const modules = [
      'DOMHandler', 'TranslatorService', 'CacheManager', 'UsageManager',
      'UIManager', 'DOMSelector', 'DOMObserver', 'DOMManipulator', 'BatchEngine'
    ];
    
    modules.forEach(moduleName => {
      const status = typeof window[moduleName] !== 'undefined' ? "로드됨" : "누락";
      console.log(`- ${moduleName}: ${status}`);
    });
  }
  
  /**
   * 누락된 모듈 파일 경로 목록 가져오기
   * @param {string[]} requiredModules - 필요한 모듈 이름 배열
   * @returns {string[]} - 누락된 모듈 파일 경로 배열
   */
  function getMissingModules(requiredModules) {
    const modulePathMap = {
      'DOMSelector': "utils/dom/dom-selector.js",
      'DOMObserver': "utils/dom/dom-observer.js",
      'DOMManipulator': "utils/dom/dom-manipulator.js",
      'BatchEngine': "utils/batch/batch_engine.js",
      'TranslatorService': "utils/translator-service.js",
      'CacheManager': "utils/cache-manager.js",
      'UsageManager': "utils/usage-manager.js",
      'UIManager': "utils/ui-manager.js",
      'DOMHandler': "utils/dom/dom-handler.js"
    };
    
    return requiredModules
      .filter(moduleName => typeof window[moduleName] === 'undefined')
      .map(moduleName => modulePathMap[moduleName])
      .filter(Boolean);
  }
  
  /**
   * 번역할 텍스트 노드 처리
   * @param {Array} nodeInfoList - 텍스트 노드 정보 배열
   * @param {Array} elements - 번역 대상 요소 배열
   * @returns {Promise<number>} - 번역된 텍스트 수
   */
  async function processTextNodes(nodeInfoList, elements) {
    // 입력 검증
    if (!nodeInfoList || !Array.isArray(nodeInfoList) || nodeInfoList.length === 0) {
      console.warn(`[${TonyConfig.APP_CONFIG.appName}] 유효하지 않은 노드 정보 목록:`, nodeInfoList);
      return 0;
    }
    
    // 이미 번역 중이면 대기
    if (AppState.pendingTranslation) {
      console.log(`[${TonyConfig.APP_CONFIG.appName}] 이미 번역 작업이 대기 중입니다.`);
      return 0;
    }
    
    // 모듈 유효성 검사
    if (!window.TranslatorService || !window.DOMHandler) {
      console.error(`[${TonyConfig.APP_CONFIG.appName}] 필수 번역 모듈이 없습니다.`);
      return 0;
    }
    
    AppState.pendingTranslation = true;
    
    try {
      // 텍스트 배열 추출
      const textsToTranslate = nodeInfoList.map(item => item.text || "");
      
      // 번역 이벤트 리스너 등록 (안전한 버전)
      const batchCompleteListener = TonyConfig.createSafeEventListener('translation:batch-complete', 
        (event, detail) => {
          if (detail) {
            const total = detail.total || 0;
            const completed = detail.completed || 0;
            const cachedCount = detail.cachedCount || 0;
            const newCount = detail.newCount || 0;
            
            if (window.UIManager && typeof window.UIManager.showTranslationStatus === 'function') {
              window.UIManager.showTranslationStatus(
                `${total}개 항목 번역 중... (${completed}/${total} 배치, 캐시: ${cachedCount}, 신규: ${newCount})`
              );
            }
          }
        }
      );
      
      // 이벤트 리스너 등록
      window.addEventListener('translation:batch-complete', batchCompleteListener);
      
      // 배치 처리를 통한 번역
      const translatedItems = await window.TranslatorService.translateInBatches(
        textsToTranslate, 
        (AppState.settings && AppState.settings.batchSize) || TonyConfig.APP_CONFIG.defaultSettings.batchSize, 
        (AppState.settings && AppState.settings.maxConcurrentBatches) || TonyConfig.APP_CONFIG.defaultSettings.maxConcurrentBatches
      );
      
      // 이벤트 리스너 제거
      window.removeEventListener('translation:batch-complete', batchCompleteListener);
      
      // 번역 결과가 없으면 종료
      if (!translatedItems || !Array.isArray(translatedItems)) {
        console.warn(`[${TonyConfig.APP_CONFIG.appName}] 번역 결과가 없습니다.`);
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
      const replacedCount = window.DOMHandler.replaceTextsInDOM(
        translationDataForDOM, 
        Array.isArray(elements) ? elements : []
      );
      
      AppState.pendingTranslation = false;
      
      return replacedCount;
    } catch (error) {
      console.error(`[${TonyConfig.APP_CONFIG.appName}] 텍스트 노드 처리 오류:`, error);
      AppState.pendingTranslation = false;
      return 0;
    }
  }
  
  /**
   * 이벤트 리스너 설정
   */
  function setupEventListeners() {
    // 텍스트 노드 준비됨 이벤트 리스너
    window.addEventListener('dom:textnodes-ready', TonyConfig.createSafeEventListener(
      'dom:textnodes-ready',
      (event, detail) => {
        const nodes = detail.nodes || [];
        const elements = detail.elements || [];
        
        if (nodes.length > 0) {
          processTextNodes(nodes, elements).catch(error => {
            console.error(`[${TonyConfig.APP_CONFIG.appName}] 노드 처리 오류:`, error);
          });
        } else {
          console.warn(`[${TonyConfig.APP_CONFIG.appName}] 텍스트 노드 이벤트에 노드가 없습니다.`);
        }
      }
    ));
    
    // 번역 한도 초과 이벤트 리스너
    window.addEventListener('usage:limit-exceeded', TonyConfig.createSafeEventListener(
      'usage:limit-exceeded',
      () => {
        if (window.UIManager && typeof window.UIManager.showTranslationLimitExceeded === 'function') {
          window.UIManager.showTranslationLimitExceeded(() => {
            if (TonyConfig.isExtensionContextValid()) {
              chrome.runtime.sendMessage({ action: "openPopup" });
            }
          });
        }
      }
    ));
    
    // DOM 관련 이벤트 리스너
    window.addEventListener('dom:translating-state-changed', TonyConfig.createSafeEventListener(
      'dom:translating-state-changed',
      (event, detail) => {
        AppState.isTranslating = detail.isTranslating === true;
      }
    ));
    
    // 번역 완료 이벤트 리스너
    window.addEventListener('dom:text-replaced', TonyConfig.createSafeEventListener(
      'dom:text-replaced',
      (event, detail) => {
        const count = detail.count || 0;
        console.log(`[${TonyConfig.APP_CONFIG.appName}] ${count}개 텍스트 교체됨`);
      }
    ));
  }
  
  /**
   * 설정 로드
   * @returns {Promise<Object>} - 설정 객체
   */
  async function loadSettings() {
    return new Promise((resolve) => {
      if (!TonyConfig.isExtensionContextValid()) {
        // 컨텍스트가 무효화된 경우 기본 설정 사용
        const defaultSettings = TonyConfig.APP_CONFIG.defaultSettings;
        AppState.settings = defaultSettings;
        applySettings(defaultSettings);
        resolve(defaultSettings);
        return;
      }
      
      try {
        chrome.storage.sync.get('settings', (data) => {
          try {
            // 기본 설정
            const defaultSettings = TonyConfig.APP_CONFIG.defaultSettings;
            
            // 사용자 설정과 기본 설정 병합
            const settings = data && data.settings ? { ...defaultSettings, ...data.settings } : defaultSettings;
            
            // 설정 적용
            applySettings(settings);
            
            AppState.settings = settings;
            resolve(settings);
          } catch (innerError) {
            console.error(`[${TonyConfig.APP_CONFIG.appName}] 설정 처리 오류:`, innerError);
            
            // 오류 시 기본 설정 사용
            const defaultSettings = TonyConfig.APP_CONFIG.defaultSettings;
            AppState.settings = defaultSettings;
            applySettings(defaultSettings);
            resolve(defaultSettings);
          }
        });
      } catch (error) {
        console.error(`[${TonyConfig.APP_CONFIG.appName}] 설정 로드 오류:`, error);
        
        // 오류 시 기본 설정 사용
        const defaultSettings = TonyConfig.APP_CONFIG.defaultSettings;
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
    if (window.TranslatorService && typeof window.TranslatorService.updateSettings === 'function') {
      try {
        window.TranslatorService.updateSettings({ 
          targetLang: settings.targetLang,
          workerEndpoint: TonyConfig.APP_CONFIG.apiEndpoint
        });
      } catch (error) {
        console.error(`[${TonyConfig.APP_CONFIG.appName}] TranslatorService 설정 오류:`, error);
      }
    }
    
    // DOMHandler 설정 적용
    if (window.DOMHandler && typeof window.DOMHandler.updateSettings === 'function') {
      try {
        window.DOMHandler.updateSettings({
          minTextLength: settings.minTextLength,
          translateFullPage: settings.translateFullPage,
          immediateTranslation: settings.immediateTranslation
        });
      } catch (error) {
        console.error(`[${TonyConfig.APP_CONFIG.appName}] DOMHandler 설정 오류:`, error);
      }
    }
    
    // CacheManager 설정 적용
    if (window.CacheManager && typeof window.CacheManager.updateSettings === 'function') {
      try {
        window.CacheManager.updateSettings(TonyConfig.APP_CONFIG.cacheSettings);
      } catch (error) {
        console.error(`[${TonyConfig.APP_CONFIG.appName}] CacheManager 설정 오류:`, error);
      }
    }
    
    // UIManager 설정 적용
    if (window.UIManager && typeof window.UIManager.updateSettings === 'function') {
      try {
        window.UIManager.updateSettings(TonyConfig.APP_CONFIG.uiSettings);
      } catch (error) {
        console.error(`[${TonyConfig.APP_CONFIG.appName}] UIManager 설정 오류:`, error);
      }
    }
  }
  
  /**
   * 웹페이지 번역 프로세스
   * @returns {Promise<string>} - 번역 결과 메시지
   */
  async function translatePage() {
    console.log(`[${TonyConfig.APP_CONFIG.appName}] 페이지 번역 시작`);
    
    // 이미 번역 중이면 중복 실행 방지
    if (AppState.isTranslating) {
      return "이미 번역 중입니다.";
    }
    
    // 컨텍스트 확인
    if (!TonyConfig.isExtensionContextValid()) {
      console.warn(`[${TonyConfig.APP_CONFIG.appName}] 확장 프로그램 컨텍스트가 무효화됨`);
      return "확장 프로그램 컨텍스트 오류. 페이지를 새로고침 해주세요.";
    }
    
    // 필수 모듈 확인
    if (!window.DOMHandler || !window.UIManager) {
      console.error(`[${TonyConfig.APP_CONFIG.appName}] 필수 모듈이 로드되지 않음`);
      return "필수 모듈이 로드되지 않았습니다.";
    }
    
    // 번역 상태 설정
    AppState.isTranslating = true;
    window.DOMHandler.setTranslatingState(true);
    
    // 번역 진행 상태 표시
    window.UIManager.showTranslationStatus("번역 준비 중...");
    
    try {
      // 설정 로드 (필요시)
      if (!AppState.settings) {
        await loadSettings();
      }
      
      // 기존 번역 상태 초기화
      window.DOMHandler.resetTranslationState();
      
      // IntersectionObserver 기반 번역 시스템 초기화
      window.DOMHandler.initialize();
      
      window.UIManager.showTranslationStatus("번역 진행 중...");
      
      // 완료 메시지 표시 (IntersectionObserver가 비동기적으로 번역 시작)
      setTimeout(() => {
        if (AppState.isTranslating) {
          window.UIManager.showTranslationStatus("페이지 스크롤 시 추가 콘텐츠가 자동으로 번역됩니다.", true);
          
          // 일정 시간 후 상태 메시지 숨기기
          setTimeout(() => {
            window.UIManager.hideTranslationStatus();
            
            // 번역 상태 업데이트
            AppState.isTranslating = false;
            window.DOMHandler.setTranslatingState(false);
          }, TonyConfig.APP_CONFIG.uiSettings.autoHideDelay);
        }
      }, 1000);
      
      return "번역이 시작되었습니다. 페이지 스크롤 시 추가 콘텐츠가 자동으로 번역됩니다.";
    } catch (error) {
      console.error(`[${TonyConfig.APP_CONFIG.appName}] 번역 오류:`, error);
      try {
        window.UIManager.hideTranslationStatus();
      } catch (e) {}
      
      AppState.isTranslating = false;
      try {
        window.DOMHandler.setTranslatingState(false);
      } catch (e) {}
      
      return `번역 오류: ${error.message || '알 수 없는 오류'}`;
    }
  }
  
  /**
   * 크롬 메시지 리스너 설정
   */
  function setupMessageListeners() {
    // 컨텍스트가 유효하지 않으면 실행하지 않음
    if (!TonyConfig.isExtensionContextValid()) return;
    
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
              if (TonyConfig.isExtensionContextValid()) {
                sendResponse({ success: true, result });
              }
            }).catch(error => {
              console.error(`[${TonyConfig.APP_CONFIG.appName}] 오류:`, error);
              if (TonyConfig.isExtensionContextValid()) {
                sendResponse({ success: false, error: error.message || '알 수 없는 오류' });
              }
            });
            return true; // 비동기 응답을 위해 true 반환
            
          case "updateSettings":
            // 설정 업데이트
            loadSettings().then(() => {
              // 설정 변경 후 번역 시스템 재초기화
              if (document.body && window.DOMHandler) {
                window.DOMHandler.resetTranslationState();
                window.DOMHandler.initialize();
              }
              
              if (TonyConfig.isExtensionContextValid()) {
                sendResponse({ success: true });
              }
            }).catch(error => {
              console.error(`[${TonyConfig.APP_CONFIG.appName}] 설정 업데이트 오류:`, error);
              if (TonyConfig.isExtensionContextValid()) {
                sendResponse({ success: false, error: error.message || '알 수 없는 오류' });
              }
            });
            return true;
            
          default:
            // 알 수 없는 메시지는 무시
            return false;
        }
      } catch (error) {
        console.error(`[${TonyConfig.APP_CONFIG.appName}] 메시지 처리 오류:`, error);
        // 컨텍스트가 여전히 유효하면 응답 시도
        if (TonyConfig.isExtensionContextValid()) {
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
              console.error(`[${TonyConfig.APP_CONFIG.appName}] 자동 번역 오류:`, error);
            });
          }
        }).catch(error => {
          console.error(`[${TonyConfig.APP_CONFIG.appName}] 설정 로드 오류:`, error);
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
          if (window.CacheManager && typeof window.CacheManager.cleanupExpired === 'function') {
            window.CacheManager.cleanupExpired();
          }
        } catch (error) {
          console.error(`[${TonyConfig.APP_CONFIG.appName}] 캐시 정리 오류:`, error);
        }
      }, 10000);
    } catch (error) {
      console.error(`[${TonyConfig.APP_CONFIG.appName}] 자동 번역 설정 오류:`, error);
    }
  }
  
  /**
   * 번역 확장 초기화 메인 함수
   */
  async function initializeTranslator() {
    try {
      // TonyConfig 모듈이 있는지 확인
      if (typeof TonyConfig === 'undefined') {
        console.error("TonyConfig 모듈이 로드되지 않았습니다. 먼저 config.js를 로드해야 합니다.");
        return false;
      }
      
      // 모듈 로드 확인 (비동기적으로 대기)
      await ensureModulesLoaded();
      
      // 초기화 표시 - 플래그 설정
      window.tonyTranslatorInitialized = true;
      
      // 이벤트 리스너 설정
      setupEventListeners();
      
      // 크롬 메시지 리스너 설정 (확장 프로그램 컨텍스트가 유효한 경우에만)
      if (TonyConfig.isExtensionContextValid()) {
        setupMessageListeners();
      }
      
      // 설정 로드
      await loadSettings();
      
      // 자동 번역 설정
      setupAutoTranslate();
      
      // 페이지 언로드 시 리소스 정리
      window.addEventListener('beforeunload', () => {
        try {
          if (window.DOMHandler && typeof window.DOMHandler.cleanup === 'function') {
            window.DOMHandler.cleanup();
          }
        } catch (error) {
          console.error(`[${TonyConfig.APP_CONFIG.appName}] 리소스 정리 오류:`, error);
        }
      });
      
      // 필요한 기능을 전역으로 노출
      window.tonyTranslator = {
        translatePage,
        getSettings: () => AppState.settings,
        safeDispatchEvent: TonyConfig.safeDispatchEvent
      };
      
      console.log(`[${TonyConfig.APP_CONFIG.appName}] 초기화 완료`);
      return true;
    } catch (error) {
      console.error(`[${TonyConfig.APP_CONFIG.appName}] 초기화 실패:`, error);
      return false;
    }
  }
  
  // 애플리케이션 초기화 (비동기)
  initializeTranslator().catch(error => {
    console.error(`[${TonyConfig.APP_CONFIG.appName}] 초기화 실패:`, error);
  });
})();