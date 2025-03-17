// dom-selector.js - TonyConfig 활용 리팩토링 버전
const DOMSelector = (function() {
    'use strict';
    
    // 기본 설정 (TonyConfig에서 가져옴)
    const DEFAULT_SETTINGS = {
      minTextLength: TonyConfig.APP_CONFIG.defaultSettings.minTextLength || 2,
      textContainerSelector: 'p, h1, h2, h3, h4, h5, li, span, a, td, div, article',
      ignoreSelector: 'script, style, noscript, code, pre',
      translatedAttr: TonyConfig.APP_CONFIG.domAttributes.translatedAttr,
      pendingAttr: TonyConfig.APP_CONFIG.domAttributes.pendingAttr,
      sourceAttr: TonyConfig.APP_CONFIG.domAttributes.sourceAttr,
      additionalSelector: '.text, .title, .headline, .desc, .content, .caption, .summary, .article-txt, .article-tit'
    };
    
    // 현재 설정
    let settings = {...DEFAULT_SETTINGS};
    
    /**
     * 요소가 텍스트 컨테이너인지 확인
     * @param {Element} element - 확인할 요소
     * @returns {boolean} - 텍스트 컨테이너 여부
     */
    function isTextContainer(element) {
      try {
        if (!element || !(element instanceof Element)) {
          return false;
        }
        
        // 상태 확인 (번역 완료 또는 대기 중인 요소 제외)
        if (hasTranslationAttributes(element)) {
          return false;
        }
        
        // 무시할 선택자에 매칭되는 요소 제외
        if (matchesSelector(element, settings.ignoreSelector)) {
          return false;
        }
        
        // 요소 내 텍스트 길이 확인
        if (!hasMinimumTextContent(element)) {
          return false;
        }
        
        // 텍스트 노드 및 속성 확인
        return hasTextNodesOrAttributes(element);
      } catch (error) {
        handleError('텍스트 컨테이너 확인 오류', error);
        return false;
      }
    }
    
    /**
     * 번역 관련 속성 확인
     * @param {Element} element - 확인할 요소
     * @returns {boolean} - 번역 속성 존재 여부
     */
    function hasTranslationAttributes(element) {
      return element.hasAttribute(settings.translatedAttr) || 
             element.hasAttribute(settings.pendingAttr);
    }
    
    /**
     * 선택자 매칭 여부 확인 (안전하게)
     * @param {Element} element - 확인할 요소
     * @param {string} selector - CSS 선택자
     * @returns {boolean} - 매칭 여부
     */
    function matchesSelector(element, selector) {
      try {
        if (!element.matches || !isValidSelector(selector)) {
          return false;
        }
        return element.matches(selector);
      } catch (matchError) {
        console.warn(`[${TonyConfig.APP_CONFIG.appName}] matches 함수 오류:`, matchError);
        return false;
      }
    }
    
    /**
     * 최소 텍스트 길이 충족 여부 확인
     * @param {Element} element - 확인할 요소
     * @returns {boolean} - 최소 길이 충족 여부
     */
    function hasMinimumTextContent(element) {
      try {
        const text = element.textContent.trim();
        return text.length >= settings.minTextLength;
      } catch (textContentError) {
        console.warn(`[${TonyConfig.APP_CONFIG.appName}] textContent 접근 오류:`, textContentError);
        return false;
      }
    }
    
    /**
     * 텍스트 노드 또는 속성 확인
     * @param {Element} element - 확인할 요소
     * @returns {boolean} - 텍스트 노드 또는 속성 존재 여부
     */
    function hasTextNodesOrAttributes(element) {
      // 자식 텍스트 노드 확인
      const hasTextNodes = checkTextNodes(element);
      
      // 속성 텍스트 확인
      const hasAttributes = checkTextAttributes(element);
      
      return hasTextNodes || hasAttributes;
    }
    
    /**
     * 텍스트 노드 확인
     * @param {Element} element - 확인할 요소
     * @returns {boolean} - 의미 있는 텍스트 노드 존재 여부
     */
    function checkTextNodes(element) {
      try {
        return Array.from(element.childNodes).some(
          node => node.nodeType === Node.TEXT_NODE && 
                 node.textContent && 
                 node.textContent.trim().length >= settings.minTextLength
        );
      } catch (childrenError) {
        console.warn(`[${TonyConfig.APP_CONFIG.appName}] 자식 노드 확인 오류:`, childrenError);
        return false;
      }
    }
    
    /**
     * 텍스트 속성 확인
     * @param {Element} element - 확인할 요소
     * @returns {boolean} - 의미 있는 텍스트 속성 존재 여부
     */
    function checkTextAttributes(element) {
      try {
        return ['title', 'alt', 'placeholder', 'aria-label'].some(
          attr => element.hasAttribute && 
                 element.hasAttribute(attr) && 
                 element.getAttribute(attr) && 
                 element.getAttribute(attr).trim().length >= settings.minTextLength
        );
      } catch (attrError) {
        console.warn(`[${TonyConfig.APP_CONFIG.appName}] 속성 확인 오류:`, attrError);
        return false;
      }
    }
    
    /**
     * 노드가 특정 선택자에 매칭되는 부모를 가지고 있는지 확인
     * @param {Node} node - 확인할 노드
     * @param {string} selector - CSS 선택자
     * @returns {boolean} - 매칭되는 부모 존재 여부
     */
    function hasParentMatching(node, selector) {
      // 선택자가 유효하지 않으면 즉시 반환
      if (!node || !selector || !isValidSelector(selector)) {
        return false;
      }
      
      try {
        let parent = node.parentNode;
      
        while (parent && parent !== document.body) {
          if (parent.nodeType === Node.ELEMENT_NODE) {
            if (safeMatches(parent, selector)) {
              return true;
            }
          }
          parent = parent.parentNode;
        }
        
        return false;
      } catch (error) {
        handleError('부모 노드 확인 오류', error);
        return false;
      }
    }
    
    /**
     * 요소에서 텍스트 노드 추출
     * @param {Element} element - 텍스트 노드를 추출할 요소
     * @returns {Array} - 노드와 위치 정보 배열 [{node, text, xpath}]
     */
    function extractTextNodesFromElement(element) {
      try {
        if (!element || !(element instanceof Element)) {
          return [];
        }
        
        const textNodes = [];
        
        // TreeWalker로 요소 내 텍스트 노드 탐색
        extractTextNodesWithTreeWalker(element, textNodes);
        
        // 속성 텍스트 추출
        extractTextAttributes(element, textNodes);
        
        return textNodes;
      } catch (error) {
        handleError('텍스트 노드 추출 오류', error);
        return [];
      }
    }
    
    /**
     * TreeWalker를 사용한 텍스트 노드 추출
     * @param {Element} element - 대상 요소
     * @param {Array} textNodes - 추출 결과 배열
     */
    function extractTextNodesWithTreeWalker(element, textNodes) {
      try {
        const walker = document.createTreeWalker(
          element,
          NodeFilter.SHOW_TEXT,
          {
            acceptNode: function(node) {
              // 무시할 요소의 자식인 경우 제외
              if (hasParentMatching(node, settings.ignoreSelector)) {
                return NodeFilter.FILTER_REJECT;
              }
              
              // 텍스트 노드의 내용이 있는 경우만 포함
              const text = node.textContent.trim();
              if (text.length >= settings.minTextLength) {
                return NodeFilter.FILTER_ACCEPT;
              }
              
              return NodeFilter.FILTER_SKIP;
            }
          }
        );
        
        // TreeWalker로 노드 탐색
        let node;
        while (node = walker.nextNode()) {
          try {
            const text = node.textContent.trim();
            if (text) {
              textNodes.push({
                node,
                text,
                type: 'text',
                element: node.parentElement
              });
            }
          } catch (nodeError) {
            console.warn(`[${TonyConfig.APP_CONFIG.appName}] 텍스트 노드 처리 오류:`, nodeError);
          }
        }
      } catch (walkerError) {
        console.error(`[${TonyConfig.APP_CONFIG.appName}] TreeWalker 오류:`, walkerError);
      }
    }
    
    /**
     * 속성 텍스트 추출
     * @param {Element} element - 대상 요소
     * @param {Array} textNodes - 추출 결과 배열
     */
    function extractTextAttributes(element, textNodes) {
      const textAttributes = ['title', 'alt', 'placeholder', 'aria-label'];
      
      try {
        // 요소 자체의 속성 확인
        textAttributes.forEach(attr => {
          extractAttributeFromElement(element, attr, textNodes);
        });
        
        // 하위 요소의 속성 확인
        textAttributes.forEach(attr => {
          extractAttributesFromChildren(element, attr, textNodes);
        });
      } catch (attrsError) {
        console.error(`[${TonyConfig.APP_CONFIG.appName}] 속성 처리 오류:`, attrsError);
      }
    }
    
    /**
     * 요소의 속성 텍스트 추출
     * @param {Element} element - 대상 요소
     * @param {string} attr - 속성 이름
     * @param {Array} textNodes - 추출 결과 배열
     */
    function extractAttributeFromElement(element, attr, textNodes) {
      try {
        if (element.hasAttribute && element.hasAttribute(attr)) {
          const text = element.getAttribute(attr).trim();
          if (text && text.length >= settings.minTextLength) {
            textNodes.push({
              node: element,
              text: text,
              type: 'attribute',
              attribute: attr,
              element: element
            });
          }
        }
      } catch (attrError) {
        console.warn(`[${TonyConfig.APP_CONFIG.appName}] 속성 '${attr}' 처리 오류:`, attrError);
      }
    }
    
    /**
     * 하위 요소의 속성 텍스트 추출
     * @param {Element} element - 대상 요소
     * @param {string} attr - 속성 이름
     * @param {Array} textNodes - 추출 결과 배열
     */
    function extractAttributesFromChildren(element, attr, textNodes) {
      try {
        const elements = element.querySelectorAll(`[${attr}]`);
        elements.forEach(el => {
          extractAttributeFromElement(el, attr, textNodes);
        });
      } catch (querySelectorError) {
        console.warn(`[${TonyConfig.APP_CONFIG.appName}] 속성 선택자 오류:`, querySelectorError);
      }
    }
    
    /**
     * 요소 내에서 텍스트 컨테이너 요소들을 찾기
     * @param {Element} root - 검색 시작점 요소
     * @returns {Array<Element>} - 찾은 텍스트 컨테이너 요소 배열
     */
    function findTextContainers(root) {
      try {
        if (!root || !(root instanceof Element)) {
          return [];
        }
        
        const containers = [];
        
        // 이미 번역된 요소는 건너뜀
        if (hasTranslationAttributes(root)) {
          return containers;
        }
        
        // root 요소 자체가 텍스트 컨테이너인지 확인
        if (isTextContainer(root)) {
          containers.push(root);
        }
        
        // 특정 선택자로 하위 요소 검색
        findContainersBySelector(root, containers);
        
        return containers;
      } catch (error) {
        handleError('텍스트 컨테이너 탐색 오류', error);
        return [];
      }
    }
    
    /**
     * 선택자로 텍스트 컨테이너 검색
     * @param {Element} root - 검색 시작점 요소
     * @param {Array} containers - 결과 저장 배열
     */
    function findContainersBySelector(root, containers) {
      try {
        // 선택자 확장 (결합)
        const fullSelector = `${settings.textContainerSelector}, ${settings.additionalSelector}`;
        
        const elements = root.querySelectorAll(fullSelector);
        
        elements.forEach(element => {
          try {
            // 번역 관련 속성이 있는 요소는 제외
            if (hasTranslationAttributes(element)) {
              return;
            }
            
            // 무시할 선택자에 매칭되는 요소는 제외
            if (matchesSelector(element, settings.ignoreSelector)) {
              return;
            }
            
            // 텍스트 내용이 있는 요소만 추가
            if (hasMinimumTextContent(element)) {
              containers.push(element);
            }
          } catch (elementError) {
            console.warn(`[${TonyConfig.APP_CONFIG.appName}] 컨테이너 요소 처리 오류:`, elementError);
          }
        });
      } catch (querySelectorError) {
        console.error(`[${TonyConfig.APP_CONFIG.appName}] querySelector 오류:`, querySelectorError);
      }
    }
    
    /**
     * 특정 선택자의 요소들 찾기
     * @param {string} selector - CSS 선택자
     * @returns {NodeList} - 찾은 요소들
     */
    function findElements(selector) {
      try {
        if (!selector || typeof selector !== 'string') return [];
        
        // 선택자 유효성 검사
        if (!isValidSelector(selector)) {
          console.warn(`[${TonyConfig.APP_CONFIG.appName}] 잘못된 선택자: ${selector}`);
          return [];
        }
        
        return document.querySelectorAll(selector);
      } catch (error) {
        handleError('요소 검색 오류', error);
        return [];
      }
    }
    
    /**
     * 선택자로 단일 요소 찾기
     * @param {string} selector - CSS 선택자
     * @returns {Element|null} - 찾은 요소 또는 null
     */
    function findElement(selector) {
      try {
        if (!selector || typeof selector !== 'string') return null;
        
        // 선택자 유효성 검사
        if (!isValidSelector(selector)) {
          console.warn(`[${TonyConfig.APP_CONFIG.appName}] 잘못된 선택자: ${selector}`);
          return null;
        }
        
        return document.querySelector(selector);
      } catch (error) {
        handleError('요소 검색 오류', error);
        return null;
      }
    }
    
    /**
     * 전체 페이지에서 번역 가능한 모든 텍스트 노드 추출
     * @returns {Array} - 노드와 위치 정보 배열 [{node, text, element}]
     */
    function extractAllTextNodes() {
      const textNodes = [];
      
      try {
        // 전체 페이지에서 텍스트 컨테이너 찾기
        const containers = findTextContainers(document.body);
        
        // 각 컨테이너에서 텍스트 노드 추출
        containers.forEach(container => {
          const nodes = extractTextNodesFromElement(container);
          textNodes.push(...nodes);
        });
        
        console.log(`[${TonyConfig.APP_CONFIG.appName}] 전체 페이지에서 ${textNodes.length}개 텍스트 노드 추출됨`);
      } catch (error) {
        handleError('전체 텍스트 노드 추출 오류', error);
      }
      
      return textNodes;
    }
    
    /**
     * 선택자 유효성 검사
     * @param {string} selector - CSS 선택자
     * @returns {boolean} - 유효성 여부
     */
    function isValidSelector(selector) {
      try {
        // 빈 선택자나 null 체크
        if (!selector || typeof selector !== 'string' || selector.trim() === '') {
          return false;
        }
        
        // 선택자에 특수문자가 포함된 경우 추가 검증
        if (selector.includes('(') || selector.includes(')') || 
            selector.includes('[') || selector.includes(']')) {
          // 복잡한 선택자 검증은 더 안전한 방법으로
          try {
            document.querySelector(selector);
            return true;
          } catch (e) {
            console.warn(`[${TonyConfig.APP_CONFIG.appName}] 복잡한 선택자 검증 실패: ${selector}`, e);
            return false;
          }
        }
        
        // 기본 검증
        document.createDocumentFragment().querySelector(selector);
        return true;
      } catch (error) {
        console.warn(`[${TonyConfig.APP_CONFIG.appName}] 유효하지 않은 선택자: ${selector}`, error);
        return false;
      }
    }
    
    /**
     * 안전한 matches 메서드 호출
     * @param {Element} element - 대상 요소
     * @param {string} selector - CSS 선택자
     * @returns {boolean} - 매칭 여부
     */
    function safeMatches(element, selector) {
      if (!element || !element.matches || !isValidSelector(selector)) {
        return false;
      }
      
      try {
        return element.matches(selector);
      } catch (error) {
        console.warn(`[${TonyConfig.APP_CONFIG.appName}] matches 함수 오류:`, error);
        return false;
      }
    }
    
    /**
     * 설정 업데이트
     * @param {Object} newSettings - 새 설정 값
     */
    function updateSettings(newSettings) {
      try {
        if (!newSettings) return;
        
        // 이전 설정 백업
        const oldSettings = { ...settings };
        
        // 새 설정 적용
        settings = { ...settings, ...newSettings };
        
        // 변경 사항 로깅
        logSettingsChanges(oldSettings);
      } catch (error) {
        handleError('설정 업데이트 오류', error);
      }
    }
    
    /**
     * 설정 변경 사항 로깅
     * @param {Object} oldSettings - 이전 설정
     */
    function logSettingsChanges(oldSettings) {
      const changedSettings = {};
      
      Object.entries(settings).forEach(([key, value]) => {
        if (oldSettings[key] !== value) {
          changedSettings[key] = value;
        }
      });
      
      if (Object.keys(changedSettings).length > 0) {
        console.log(`[${TonyConfig.APP_CONFIG.appName}] DOMSelector 설정 변경:`, changedSettings);
      }
    }
    
    /**
     * 현재 설정 가져오기
     * @returns {Object} - 현재 설정
     */
    function getSettings() {
      return { ...settings };
    }
    
    /**
     * 모든 번역 관련 속성 초기화
     * @returns {number} - 초기화된 요소 수
     */
    function resetAllTranslationAttributes() {
      try {
        let resetCount = 0;
        
        // 번역된 요소 데이터 속성 제거
        resetCount += resetAttributeFromElements(settings.translatedAttr);
        
        // 대기 중인 요소 데이터 속성 제거
        resetCount += resetAttributeFromElements(settings.pendingAttr);
        
        // 소스 텍스트 데이터 속성 제거
        resetCount += resetAttributeFromElements(settings.sourceAttr);
        
        console.log(`[${TonyConfig.APP_CONFIG.appName}] ${resetCount}개 번역 속성 초기화 완료`);
        return resetCount;
      } catch (error) {
        handleError('번역 속성 초기화 오류', error);
        return 0;
      }
    }
    
    /**
     * 특정 속성을 가진 요소들의 속성 제거
     * @param {string} attributeName - 제거할 속성 이름
     * @returns {number} - 처리된 요소 수
     */
    function resetAttributeFromElements(attributeName) {
      try {
        const elements = document.querySelectorAll(`[${attributeName}]`);
        let count = 0;
        
        elements.forEach(element => {
          try {
            if (element && element.removeAttribute) {
              element.removeAttribute(attributeName);
              count++;
            }
          } catch (attrError) {
            console.warn(`[${TonyConfig.APP_CONFIG.appName}] 속성 제거 오류:`, attrError);
          }
        });
        
        return count;
      } catch (error) {
        console.warn(`[${TonyConfig.APP_CONFIG.appName}] 속성 리셋 오류:`, error);
        return 0;
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
        TonyConfig.safeDispatchEvent('domselector:error', {
          message,
          error: error.message
        });
      } catch (eventError) {
        console.warn(`[${TonyConfig.APP_CONFIG.appName}] 이벤트 발행 오류:`, eventError);
      }
    }
    
    // 공개 API
    return {
      isTextContainer,
      hasParentMatching,
      extractTextNodesFromElement,
      findTextContainers,
      findElements,
      findElement,
      extractAllTextNodes,
      updateSettings,
      getSettings,
      resetAllTranslationAttributes,
      isValidSelector,
      safeMatches
    };
  })();
  
  // 모듈 내보내기
  window.DOMSelector = DOMSelector;