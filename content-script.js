// content-script.js - IntersectionObserver 중심 개선 버전
(function() {
  'use strict';
  
  // 초기화 플래그 확인 - 함수 내부 최상단에 위치
  if (window.tonyTranslatorInitialized) {
    console.log("[번역 익스텐션] 이미 초기화되어 중복 실행 방지");
    return; // 이미 초기화되었다면 함수 실행 중단
  }
  
  // 필요한 모듈이 모두 로드되었는지 확인
  if (!window.DOMHandler || !window.TranslatorService || !window.CacheManager || !window.UsageManager || !window.UIManager) {
    console.error("[번역 익스텐션] 필요한 모듈이 로드되지 않았습니다. 로드 순서를 확인하세요.");
    console.log("DOMHandler:", !!window.DOMHandler);
    console.log("TranslatorService:", !!window.TranslatorService);
    console.log("CacheManager:", !!window.CacheManager);
    console.log("UsageManager:", !!window.UsageManager);
    console.log("UIManager:", !!window.UIManager);
    return; // 필요한 모듈이 없으면 실행 중단
  }
  
  // 초기화 표시 - 플래그 설정
  window.tonyTranslatorInitialized = true;
  
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
      DOMHandler.resetTranslationState();
    }
  };
  
  /**
   * 설정 로드
   * @returns {Promise<Object>} - 설정 객체
   */
  async function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get('settings', (data) => {
        // 기본 설정
        const defaultSettings = {
          targetLang: 'ko',
          autoTranslate: false,
          minTextLength: 2,
          batchSize: 40,
          maxConcurrentBatches: 3,
          rootMargin: '200px',
          textContainerSelector: 'p, h1, h2, h3, h4, h5, h6, li, span, a, td, th, caption, label, button, div:not(:empty)',
          ignoreSelector: 'script, style, noscript, code, pre'
        };
        
        // 사용자 설정과 기본 설정 병합
        const settings = data.settings ? { ...defaultSettings, ...data.settings } : defaultSettings;
        
        // 각 모듈에 설정 전달
        if (window.TranslatorService) {
          TranslatorService.updateSettings({ 
            targetLang: settings.targetLang,
            workerEndpoint: 'https://translate-worker.redofyear2.workers.dev'
          });
        }
        
        if (window.DOMHandler) {
          DOMHandler.updateSettings({
            minTextLength: settings.minTextLength,
            rootMargin: settings.rootMargin,
            textContainerSelector: settings.textContainerSelector,
            ignoreSelector: settings.ignoreSelector
          });
        }
        
        if (window.CacheManager) {
          CacheManager.updateSettings({
            expiryDays: 30  // 캐시 만료일 설정
          });
        }
        
        if (window.UIManager) {
          UIManager.updateSettings({
            statusTimeout: 2000,
            limitExceededTimeout: 10000
          });
        }
        
        AppState.settings = settings;
        resolve(settings);
      });
    });
  }
  
  /**
   * 웹페이지 번역 프로세스
   * @returns {Promise<string>} - 번역 결과 메시지
   */
  async function translatePage() {
    console.log("[번역 익스텐션] 페이지 번역 시작");
    
    // 이미 번역 중이면 중복 실행 방지
    if (AppState.isTranslating) {
      return "이미 번역 중입니다.";
    }
    
    // 번역 상태 설정
    AppState.isTranslating = true;
    DOMHandler.setTranslatingState(true);
    
    // 번역 진행 상태 표시
    UIManager.showTranslationStatus("번역 준비 중...");
    
    try {
      // 설정 로드
      if (!AppState.settings) {
        await loadSettings();
      }
      
      // 기존 번역 상태 초기화
      DOMHandler.resetTranslationState();
      
      // IntersectionObserver 기반 번역 시스템 초기화
      DOMHandler.initialize();
      
      UIManager.showTranslationStatus("번역 진행 중...", true);
      
      // 완료 메시지 표시 (IntersectionObserver가 비동기적으로 번역 시작)
      setTimeout(() => {
        if (AppState.isTranslating) {
          UIManager.showTranslationStatus("페이지 스크롤 시 추가 콘텐츠가 자동으로 번역됩니다.", true);
          
          // 일정 시간 후 상태 메시지 숨기기
          setTimeout(() => {
            UIManager.hideTranslationStatus();
            
            // 번역 상태 업데이트
            AppState.isTranslating = false;
            DOMHandler.setTranslatingState(false);
          }, 3000);
        }
      }, 1000);
      
      return "번역이 시작되었습니다. 페이지 스크롤 시 추가 콘텐츠가 자동으로 번역됩니다.";
    } catch (error) {
      UIManager.hideTranslationStatus();
      AppState.isTranslating = false;
      DOMHandler.setTranslatingState(false);
      console.error("[번역 익스텐션] 번역 오류:", error);
      throw error;
    }
  }
  
  /**
   * 번역할 텍스트 노드 처리
   * @param {Array} nodeInfoList - 텍스트 노드 정보 배열
   * @param {Array} elements - 번역 대상 요소 배열
   * @returns {Promise<number>} - 번역된 텍스트 수
   */
  async function processTextNodes(nodeInfoList, elements) {
    // 이미 번역 중이면 대기
    if (AppState.pendingTranslation) {
      console.log("[번역 익스텐션] 이미 번역 작업이 대기 중입니다.");
      return 0;
    }
    
    // 번역할 텍스트가 없으면 건너뜀
    if (!nodeInfoList || nodeInfoList.length === 0) {
      return 0;
    }
    
    AppState.pendingTranslation = true;
    
    try {
      // 텍스트 배열 추출
      const textsToTranslate = nodeInfoList.map(item => item.text);
      
      // 번역 이벤트 리스너 등록
      const batchCompleteListener = (event) => {
        const detail = event.detail;
        UIManager.showTranslationStatus(
          `${detail.total}개 항목 번역 중... (${detail.completed}/${detail.total} 배치, 캐시: ${detail.cachedCount}, 신규: ${detail.newCount})`
        );
      };
      
      // 이벤트 리스너 등록
      window.addEventListener('translation:batch-complete', batchCompleteListener);
      
      // 배치 처리를 통한 번역
      const translatedItems = await TranslatorService.translateInBatches(
        textsToTranslate, 
        AppState.settings.batchSize, 
        AppState.settings.maxConcurrentBatches
      );
      
      // 이벤트 리스너 제거
      window.removeEventListener('translation:batch-complete', batchCompleteListener);
      
      // 번역 결과를 DOM에 적용하기 위한 형식으로 변환
      const translationDataForDOM = translatedItems.map((item, index) => ({
        original: item.original,
        translated: item.translated,
        xpath: nodeInfoList[index].xpath
      }));
      
      // 번역된 텍스트 DOM에 적용
      const replacedCount = DOMHandler.replaceTextsInDOM(translationDataForDOM, elements);
      
      AppState.pendingTranslation = false;
      
      return replacedCount;
    } catch (error) {
      console.error("[번역 익스텐션] 텍스트 노드 처리 오류:", error);
      AppState.pendingTranslation = false;
      return 0;
    }
  }
  
  /**
   * 크롬 메시지 리스너 설정
   */
  function setupMessageListeners() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      // ping 메시지 - 컨텐츠 스크립트가 로드되었는지 확인용
      if (request.action === "ping") {
        sendResponse({ status: "ready" });
        return true;
      }
      
      // 번역 요청
      if (request.action === "translatePage") {
        translatePage().then(result => {
          sendResponse({ success: true, result });
        }).catch(error => {
          console.error("[번역 익스텐션] 오류:", error);
          sendResponse({ success: false, error: error.message });
        });
        return true; // 비동기 응답을 위해 true 반환
      }
      
      // 설정 업데이트
      if (request.action === "updateSettings") {
        loadSettings().then(() => {
          // 설정 변경 후 번역 시스템 재초기화
          if (document.body) {
            DOMHandler.resetTranslationState();
            DOMHandler.initialize();
          }
          sendResponse({ success: true });
        });
        return true;
      }
    });
  }
  
  /**
   * 이벤트 리스너 설정
   */
  function setupEventListeners() {
    // 번역 한도 초과 이벤트 리스너
    window.addEventListener('usage:limit-exceeded', () => {
      UIManager.showTranslationLimitExceeded(() => {
        chrome.runtime.sendMessage({ action: "openPopup" });
      });
    });
    
    // DOM 관련 이벤트 리스너
    window.addEventListener('dom:translating-state-changed', (event) => {
      const { isTranslating } = event.detail;
      AppState.isTranslating = isTranslating;
    });
    
    // 텍스트 노드 준비됨 이벤트 리스너
    window.addEventListener('dom:textnodes-ready', (event) => {
      const { nodes, elements } = event.detail;
      processTextNodes(nodes, elements);
    });
    
    // 번역 완료 이벤트 리스너
    window.addEventListener('dom:text-replaced', (event) => {
      const { count } = event.detail;
      // 특별한 처리 필요 시 여기에 추가
    });
  }
  
  /**
   * 페이지 로드 완료 시 자동 번역 설정
   */
  function setupAutoTranslate() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        // 설정 로드
        loadSettings().then(settings => {
          if (settings.autoTranslate) {
            translatePage();
          }
        });
      });
    } else {
      // 이미 DOM이 로드된 경우
      loadSettings().then(settings => {
        if (settings.autoTranslate) {
          translatePage();
        }
      });
    }
    
    // 주기적으로 오래된 캐시 정리
    setTimeout(() => CacheManager.cleanupExpired(), 10000);
  }
  
  /**
   * 초기화 및 라이프사이클 관리
   */
  function init() {
    // 메시지 리스너 설정
    setupMessageListeners();
    
    // 이벤트 리스너 설정
    setupEventListeners();
    
    // 자동 번역 설정
    setupAutoTranslate();
    
    // 페이지 언로드 시 리소스 정리
    window.addEventListener('beforeunload', () => {
      DOMHandler.cleanup();
    });
    
    // 필요한 기능을 전역으로 노출 (선택 사항)
    window.tonyTranslator = {
      translatePage,
      getSettings: () => AppState.settings
    };
    
    console.log("[번역 익스텐션] 초기화 완료");
  }
  
  // 애플리케이션 초기화
  init();
  
})();