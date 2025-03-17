// dom-observer.js - TonyConfig 활용 리팩토링 버전
const DOMObserver = (function() {
    'use strict';
  
    try {
      console.log(`[${TonyConfig.APP_CONFIG.appName}] DOM Observer 모듈 로드 시작`);
      
      // 모듈 로드 시 진단 정보 출력
      window.addEventListener('error', function(event) {
        if (event.filename && event.filename.includes('dom-observer.js')) {
          console.error(`[${TonyConfig.APP_CONFIG.appName}] DOM Observer 모듈 오류:`, event.message);
        }
      });
    } catch (initError) {
      console.error(`[${TonyConfig.APP_CONFIG.appName}] DOM Observer 모듈 초기화 오류:`, initError);
    }
    
    // 기본 설정 (TonyConfig에서 가져옴)
    const DEFAULT_SETTINGS = {
      rootMargin: '200px',
      translatedAttr: TonyConfig.APP_CONFIG.domAttributes.translatedAttr,
      pendingAttr: TonyConfig.APP_CONFIG.domAttributes.pendingAttr,
      observeAllOnInit: true,
      preloadThreshold: 0.1
    };
    
    // 현재 설정
    let settings = {...DEFAULT_SETTINGS};
    
    // 상태 관리
    const state = {
      intersectionObserver: null,
      mutationObserver: null,
      observedElements: new WeakSet(),
      isInitialized: false,
      isTranslating: false,
      isEnabled: true
    };
    
    /**
     * IntersectionObserver 초기화
     * @private
     */
    function initIntersectionObserver() {
      // 이미 초기화되었다면 중복 생성 방지
      if (state.intersectionObserver) return;
      
      try {
        state.intersectionObserver = new IntersectionObserver(
          handleIntersection, 
          { 
            rootMargin: settings.rootMargin, 
            threshold: settings.preloadThreshold
          }
        );
        
        console.log(`[${TonyConfig.APP_CONFIG.appName}] IntersectionObserver 초기화됨`);
      } catch (error) {
        handleError('IntersectionObserver 초기화 오류', error);
      }
    }
    
    /**
     * MutationObserver 초기화
     * @private
     */
    function initMutationObserver() {
      // 이미 초기화되었다면 중복 생성 방지
      if (state.mutationObserver) return;
      
      try {
        state.mutationObserver = new MutationObserver(handleMutation);
        
        // document.body 관찰 시작
        if (document.body) {
          state.mutationObserver.observe(document.body, {
            childList: true,  // 자식 노드 추가/제거 감지
            subtree: true     // 모든 하위 트리 변경 감지
          });
          
          console.log(`[${TonyConfig.APP_CONFIG.appName}] MutationObserver 초기화됨`);
        } else {
          console.warn(`[${TonyConfig.APP_CONFIG.appName}] document.body가 준비되지 않았습니다.`);
        }
      } catch (error) {
        handleError('MutationObserver 초기화 오류', error);
      }
    }
    
    /**
     * IntersectionObserver 콜백 핸들러
     * @private
     * @param {IntersectionObserverEntry[]} entries - 교차 변경된 요소들
     */
    function handleIntersection(entries) {
      try {
        // 번역 중이거나 비활성화 상태면 무시
        if (state.isTranslating || !state.isEnabled) return;
        
        // 화면에 보이는 요소만 필터링
        const visibleEntries = entries.filter(entry => entry.isIntersecting);
        
        if (visibleEntries.length === 0) return;
        
        console.log(`[${TonyConfig.APP_CONFIG.appName}] ${visibleEntries.length}개 요소가 화면에 보임`);
        
        // 번역 대상 요소들
        const elementsToProcess = visibleEntries.map(entry => entry.target).filter(Boolean);
        
        // 화면에 보이는 요소들 처리 이벤트 발생
        if (elementsToProcess.length > 0) {
          processVisibleElements(elementsToProcess);
        }
      } catch (error) {
        handleError('Intersection 처리 오류', error);
      }
    }
    
    /**
     * 화면에 보이는 요소 처리
     * @param {Element[]} elements - 화면에 보이는 요소 배열
     */
    function processVisibleElements(elements) {
      // 번역 대기 중으로 표시
      elements.forEach(element => {
        if (element && !element.hasAttribute(settings.translatedAttr)) {
          element.setAttribute(settings.pendingAttr, 'true');
        }
      });
      
      // 이벤트 발생
      safeDispatchEvent('dom:elements-visible', { 
        elements: elements 
      });
    }
    
    /**
     * MutationObserver 콜백 핸들러
     * @private
     * @param {MutationRecord[]} mutations - 감지된 DOM 변경 사항
     */
    function handleMutation(mutations) {
      try {
        // 번역 중이거나 비활성화 상태면 무시
        if (state.isTranslating || !state.isEnabled) return;
        
        // 중요한 변경사항 여부 확인
        const hasSignificantChanges = checkForSignificantChanges(mutations);
        
        // 중요한 변경사항이 없으면 건너뜀
        if (!hasSignificantChanges) return;
        
        console.log(`[${TonyConfig.APP_CONFIG.appName}] DOM 변경 감지됨, 새 텍스트 컨테이너 검색`);
        
        // 새로 추가된 요소 찾기
        const newElements = findNewlyAddedElements(mutations);
        
        // 이벤트 발생
        if (newElements.length > 0) {
          safeDispatchEvent('dom:elements-added', { 
            elements: newElements 
          });
        }
      } catch (error) {
        handleError('Mutation 처리 오류', error);
      }
    }
    
    /**
     * 중요한 DOM 변경 확인
     * @param {MutationRecord[]} mutations - 감지된 DOM 변경 사항
     * @returns {boolean} - 중요한 변경 여부
     */
    function checkForSignificantChanges(mutations) {
      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          // 실제 요소 노드가 추가되었는지 확인
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              return true;
            }
          }
        }
      }
      return false;
    }
    
    /**
     * 새로 추가된 요소 찾기
     * @param {MutationRecord[]} mutations - 감지된 DOM 변경 사항
     * @returns {Element[]} - 새로 추가된 요소 배열
     */
    function findNewlyAddedElements(mutations) {
      const newElements = [];
      mutations.forEach(mutation => {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              newElements.push(node);
            }
          });
        }
      });
      return newElements;
    }
    
    /**
     * 요소를 IntersectionObserver에 등록
     * @param {Element} element - 관찰할 요소
     */
    function observeElement(element) {
      try {
        if (!element || !(element instanceof Element)) {
          return;
        }
        
        // 이미 번역된 요소는 건너뜀
        if (element.hasAttribute(settings.translatedAttr)) {
          return;
        }
        
        // IntersectionObserver가 없으면 초기화
        if (!state.intersectionObserver) {
          initIntersectionObserver();
          if (!state.intersectionObserver) {
            console.error(`[${TonyConfig.APP_CONFIG.appName}] IntersectionObserver 초기화 실패`);
            return;
          }
        }
        
        // 이미 관찰 중인 요소는 건너뜀
        if (state.observedElements.has(element)) {
          return;
        }
        
        // 번역 대기 중으로 표시
        element.setAttribute(settings.pendingAttr, 'true');
        
        // IntersectionObserver에 등록
        state.intersectionObserver.observe(element);
        
        // 관찰 중인 요소로 추가
        state.observedElements.add(element);
      } catch (error) {
        handleError('요소 관찰 등록 오류', error);
      }
    }
    
    /**
     * 요소 배열을 IntersectionObserver에 등록
     * @param {Element[]} elements - 관찰할 요소 배열
     */
    function observeElements(elements) {
      try {
        if (!Array.isArray(elements) || elements.length === 0) {
          return;
        }
        
        elements.forEach(element => {
          observeElement(element);
        });
        
        console.log(`[${TonyConfig.APP_CONFIG.appName}] ${elements.length}개 요소 관찰 등록`);
      } catch (error) {
        handleError('요소들 관찰 등록 오류', error);
      }
    }
    
    /**
     * 번역 상태 설정
     * @param {boolean} isTranslating - 번역 중 상태
     */
    function setTranslatingState(isTranslating) {
      try {
        state.isTranslating = !!isTranslating; // 불리언 타입 강제
        
        // 상태 변경 이벤트 발행
        safeDispatchEvent('dom:translating-state-changed', { 
          isTranslating: state.isTranslating 
        });
      } catch (error) {
        handleError('번역 상태 설정 오류', error);
      }
    }
    
    /**
     * 번역 상태 가져오기
     * @returns {boolean} - 번역 중 상태
     */
    function getTranslatingState() {
      return state.isTranslating;
    }
    
    /**
     * 관찰자 활성화/비활성화 설정
     * @param {boolean} isEnabled - 활성화 여부
     */
    function setEnabled(isEnabled) {
      state.isEnabled = !!isEnabled; // 불리언 타입 강제
      console.log(`[${TonyConfig.APP_CONFIG.appName}] DOM 관찰자 ${state.isEnabled ? '활성화' : '비활성화'}`);
    }
    
    /**
     * 관찰자 초기화
     * @returns {boolean} - 초기화 성공 여부
     */
    function initialize() {
      try {
        // 이미 초기화된 경우
        if (state.isInitialized) {
          return true;
        }
        
        // 관찰자 초기화
        initIntersectionObserver();
        initMutationObserver();
        
        // 초기화 상태 설정
        state.isInitialized = true;
        state.isEnabled = true;
        
        // 초기화 완료 이벤트 발행
        safeDispatchEvent('dom:observer-initialized', { success: true });
        
        console.log(`[${TonyConfig.APP_CONFIG.appName}] DOM 관찰자 초기화 완료`);
        return true;
      } catch (error) {
        handleError('DOM 관찰자 초기화 오류', error);
        return false;
      }
    }
    
    /**
     * 화면에 현재 보이는 모든 요소 처리
     * 즉시 번역을 위해 현재 화면에 보이는 요소들을 가져옴
     * @returns {Element[]} - 화면에 보이는 요소 배열
     */
    function processVisibleElements() {
      try {
        // DOMSelector 모듈이 필요함
        if (!window.DOMSelector) {
          console.error(`[${TonyConfig.APP_CONFIG.appName}] DOMSelector 모듈이 필요합니다.`);
          return [];
        }
        
        // 텍스트 컨테이너 요소들 찾기
        const containers = window.DOMSelector.findTextContainers(document.body);
        const visibleElements = [];
        
        // 화면에 보이는 요소 필터링
        containers.forEach(element => {
          try {
            if (isElementVisible(element)) {
              visibleElements.push(element);
              
              // 번역 대기 중으로 표시
              if (!element.hasAttribute(settings.translatedAttr)) {
                element.setAttribute(settings.pendingAttr, 'true');
              }
            } else {
              // 화면에 보이지 않는 요소는 관찰자에 등록
              observeElement(element);
            }
          } catch (elementError) {
            console.warn(`[${TonyConfig.APP_CONFIG.appName}] 요소 가시성 확인 오류:`, elementError);
          }
        });
        
        console.log(`[${TonyConfig.APP_CONFIG.appName}] 현재 화면에 보이는 ${visibleElements.length}개 요소 처리`);
        
        // 화면에 보이는 요소 처리 이벤트 발행
        if (visibleElements.length > 0) {
          safeDispatchEvent('dom:elements-visible', { 
            elements: visibleElements 
          });
        }
        
        return visibleElements;
      } catch (error) {
        handleError('화면에 보이는 요소 처리 오류', error);
        return [];
      }
    }
    
    /**
     * 요소가 화면에 보이는지 확인
     * @param {Element} element - 확인할 요소
     * @returns {boolean} - 화면에 보이는지 여부
     */
    function isElementVisible(element) {
      try {
        if (!element || !(element instanceof Element)) {
          return false;
        }
        
        // 요소의 위치 및 크기 정보
        const rect = element.getBoundingClientRect();
        
        // 화면 크기
        const viewHeight = Math.max(document.documentElement.clientHeight, window.innerHeight);
        const viewWidth = Math.max(document.documentElement.clientWidth, window.innerWidth);
        
        // 화면 밖에 있는지 확인
        if (rect.bottom < 0 || rect.top > viewHeight || 
            rect.right < 0 || rect.left > viewWidth) {
          return false;
        }
        
        // 요소의 스타일 확인
        return isElementDisplayed(element);
      } catch (error) {
        handleError('요소 가시성 확인 오류', error);
        return false;
      }
    }
    
    /**
     * 요소가 화면에 표시되는지 확인
     * @param {Element} element - 확인할 요소
     * @returns {boolean} - 표시 여부
     */
    function isElementDisplayed(element) {
      const style = window.getComputedStyle(element);
      
      // 화면에 표시되지 않는 경우
      switch (true) {
        case (style.display === 'none'):
        case (style.visibility === 'hidden'):
        case (style.opacity === '0'):
        case (element.offsetParent === null):
          return false;
        default:
          return true;
      }
    }
    
    /**
     * 관찰자 정리 및 초기화
     */
    function cleanup() {
      try {
        // IntersectionObserver 정리
        cleanupObserver(state.intersectionObserver);
        state.intersectionObserver = null;
        
        // MutationObserver 정리
        cleanupObserver(state.mutationObserver);
        state.mutationObserver = null;
        
        // 상태 초기화
        state.observedElements = new WeakSet();
        state.isInitialized = false;
        state.isTranslating = false;
        
        console.log(`[${TonyConfig.APP_CONFIG.appName}] DOM 관찰자 정리 완료`);
      } catch (error) {
        handleError('DOM 관찰자 정리 오류', error);
      }
    }
    
    /**
     * 관찰자 정리
     * @param {Observer} observer - 정리할 관찰자
     */
    function cleanupObserver(observer) {
      if (observer) {
        try {
          observer.disconnect();
        } catch (observerError) {
          console.warn(`[${TonyConfig.APP_CONFIG.appName}] 관찰자 해제 오류:`, observerError);
        }
      }
    }
    
    /**
     * 설정 업데이트
     * @param {Object} newSettings - 새 설정 값
     */
    function updateSettings(newSettings) {
      try {
        if (!newSettings) return;
        
        const oldSettings = { ...settings };
        settings = { ...settings, ...newSettings };
        
        // 관찰자 설정이 변경된 경우 재초기화
        if (shouldReinitializeObserver(oldSettings)) {
          reinitializeIntersectionObserver();
        }
      } catch (error) {
        handleError('설정 업데이트 오류', error);
      }
    }
    
    /**
     * 관찰자 재초기화 필요 여부 확인
     * @param {Object} oldSettings - 이전 설정
     * @returns {boolean} - 재초기화 필요 여부
     */
    function shouldReinitializeObserver(oldSettings) {
      return oldSettings.rootMargin !== settings.rootMargin ||
             oldSettings.preloadThreshold !== settings.preloadThreshold;
    }
    
    /**
     * IntersectionObserver 재초기화
     */
    function reinitializeIntersectionObserver() {
      // 기존 관찰자 해제
      cleanupObserver(state.intersectionObserver);
      state.intersectionObserver = null;
      
      // 새 설정으로 다시 초기화
      initIntersectionObserver();
    }
    
    /**
     * 현재 설정 가져오기
     * @returns {Object} - 현재 설정
     */
    function getSettings() {
      return { ...settings };
    }
    
    /**
     * 안전한 이벤트 발행 함수
     * @param {string} eventName - 이벤트 이름
     * @param {Object} detail - 이벤트 detail 객체
     * @returns {boolean} - 이벤트 발행 성공 여부
     */
    function safeDispatchEvent(eventName, detail = {}) {
      try {
        if (!state.isEnabled) {
          return false;
        }
        
        TonyConfig.safeDispatchEvent(eventName, detail);
        return true;
      } catch (error) {
        console.error(`[${TonyConfig.APP_CONFIG.appName}] 이벤트 발행 오류 (${eventName}):`, error);
        return false;
      }
    }
    
    /**
     * 오류 처리
     * @param {string} message - 오류 메시지
     * @param {Error} error - 오류 객체
     */
    function handleError(message, error) {
      console.error(`[${TonyConfig.APP_CONFIG.appName}] ${message}:`, error);
      
      // 오류 이벤트 발행
      try {
        TonyConfig.safeDispatchEvent('domobserver:error', {
          message,
          error: error.message
        });
      } catch (eventError) {
        console.warn(`[${TonyConfig.APP_CONFIG.appName}] 오류 이벤트 발행 실패:`, eventError);
      }
    }
    
    // 공개 API
    return {
      initialize,
      observeElement,
      observeElements,
      setTranslatingState,
      getTranslatingState,
      setEnabled,
      processVisibleElements,
      isElementVisible,
      cleanup,
      updateSettings,
      getSettings,
      safeDispatchEvent
    };
  })();
  
  // 모듈 내보내기
  window.DOMObserver = DOMObserver;