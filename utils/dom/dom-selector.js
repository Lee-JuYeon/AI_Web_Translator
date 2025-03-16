// dom-selector.js - DOM 요소 선택 및 탐색 기능을 담당하는 모듈

const DOMSelector = (function() {
    'use strict';
    
    // 내부 설정 (기본값)
    const DEFAULT_SETTINGS = {
        minTextLength: 2,
        textContainerSelector: 'p, h1, h2, h3, h4, h5, li, span, a, td, div, article', // 단순화
        ignoreSelector: 'script, style, noscript, code, pre', // 단순화translatedAttr: 'data-tony-translated',
        pendingAttr: 'data-tony-pending',
        sourceAttr: 'data-tony-source',
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
        
        // 이미 번역되었거나 번역 대기 중인 요소는 제외
        if (element.hasAttribute(settings.translatedAttr) || 
            element.hasAttribute(settings.pendingAttr)) {
          return false;
        }
        
        // 무시할 선택자에 매칭되는 요소는 제외
        try {
          if (element.matches && element.matches(settings.ignoreSelector)) {
            return false;
          }
        } catch (matchError) {
          console.warn("[번역 익스텐션] matches 함수 오류:", matchError);
        }
        
        // 최소 길이 이상의 텍스트 내용이 있는지 확인
        let hasTextContent = false;
        try {
          const text = element.textContent.trim();
          hasTextContent = text.length >= settings.minTextLength;
        } catch (textContentError) {
          console.warn("[번역 익스텐션] textContent 접근 오류:", textContentError);
        }
        
        if (!hasTextContent) {
          return false;
        }
        
        // 자식 텍스트 노드 확인
        let hasTextNodeChildren = false;
        try {
          hasTextNodeChildren = Array.from(element.childNodes).some(
            node => node.nodeType === Node.TEXT_NODE && 
                   node.textContent && 
                   node.textContent.trim().length >= settings.minTextLength
          );
        } catch (childrenError) {
          console.warn("[번역 익스텐션] 자식 노드 확인 오류:", childrenError);
        }
        
        // 속성에 텍스트가 있는지 확인
        let hasAttrText = false;
        try {
          hasAttrText = ['title', 'alt', 'placeholder', 'aria-label'].some(
            attr => element.hasAttribute && 
                   element.hasAttribute(attr) && 
                   element.getAttribute(attr) && 
                   element.getAttribute(attr).trim().length >= settings.minTextLength
          );
        } catch (attrError) {
          console.warn("[번역 익스텐션] 속성 확인 오류:", attrError);
        }
        
        return hasTextContent && (hasTextNodeChildren || hasAttrText);
      } catch (error) {
        console.error("[번역 익스텐션] 텍스트 컨테이너 확인 오류:", error);
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
        try {
        if (!node || !selector) return false;
        
        // 선택자 유효성 검사
        if (!isValidSelector(selector)) {
            return false; // 유효하지 않은 선택자인 경우 즉시 반환
        }
        
        let parent = node.parentNode;
        
        while (parent && parent !== document.body) {
            if (parent.nodeType === Node.ELEMENT_NODE) {
            try {
                if (parent.matches && parent.matches(selector)) {
                return true;
                }
            } catch (matchError) {
                console.warn("[번역 익스텐션] matches 함수 오류:", matchError);
                // 오류가 발생해도 계속 진행
            }
            }
            parent = parent.parentNode;
        }
        
        return false;
        } catch (error) {
        console.error("[번역 익스텐션] 부모 노드 확인 오류:", error);
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
        
        // TreeWalker로 요소 내 모든 텍스트 노드 탐색
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
              console.warn("[번역 익스텐션] 텍스트 노드 처리 오류:", nodeError);
            }
          }
        } catch (walkerError) {
          console.error("[번역 익스텐션] TreeWalker 오류:", walkerError);
        }
        
        // 속성에 있는 텍스트 (title, alt, placeholder 등) 추가
        try {
          ['title', 'alt', 'placeholder', 'aria-label'].forEach(attr => {
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
              
              // 하위 요소의 속성도 확인
              try {
                const elements = element.querySelectorAll(`[${attr}]`);
                elements.forEach(el => {
                  try {
                    if (el && el.hasAttribute && el.hasAttribute(attr)) {
                      const text = el.getAttribute(attr).trim();
                      if (text && text.length >= settings.minTextLength) {
                        textNodes.push({
                          node: el,
                          text: text,
                          type: 'attribute',
                          attribute: attr,
                          element: el
                        });
                      }
                    }
                  } catch (attrNodeError) {
                    console.warn(`[번역 익스텐션] 속성 '${attr}' 노드 처리 오류:`, attrNodeError);
                  }
                });
              } catch (querySelectorError) {
                console.warn(`[번역 익스텐션] 속성 선택자 오류:`, querySelectorError);
              }
              
            } catch (attrError) {
              console.warn(`[번역 익스텐션] 속성 '${attr}' 처리 오류:`, attrError);
            }
          });
        } catch (attrsError) {
          console.error("[번역 익스텐션] 속성 처리 오류:", attrsError);
        }
        
        return textNodes;
      } catch (error) {
        console.error("[번역 익스텐션] 텍스트 노드 추출 오류:", error);
        return [];
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
        if (root.hasAttribute(settings.translatedAttr) || 
            root.hasAttribute(settings.pendingAttr)) {
          return containers;
        }
        
        // root 요소 자체가 텍스트 컨테이너인지 확인
        if (isTextContainer(root)) {
          containers.push(root);
        }
        
        // 선택자 확장 (결합)
        const fullSelector = `${settings.textContainerSelector}, ${settings.additionalSelector}`;
        
        // 텍스트 컨테이너 선택자로 하위 요소 검색
        try {
          const elements = root.querySelectorAll(fullSelector);
          
          elements.forEach(element => {
            try {
              // 이미 번역되었거나 번역 대기 중인 요소는 건너뜀
              if (element.hasAttribute(settings.translatedAttr) || 
                  element.hasAttribute(settings.pendingAttr)) {
                return;
              }
              
              // 무시할 선택자에 매칭되는 요소는 제외
              if (element.matches && element.matches(settings.ignoreSelector)) {
                return;
              }
              
              // 실제 텍스트가 있는 요소만 추가
              if (element.textContent && element.textContent.trim().length >= settings.minTextLength) {
                containers.push(element);
              }
            } catch (elementError) {
              console.warn("[번역 익스텐션] 컨테이너 요소 처리 오류:", elementError);
            }
          });
        } catch (querySelectorError) {
          console.error("[번역 익스텐션] querySelector 오류:", querySelectorError);
        }
        
        return containers;
      } catch (error) {
        console.error("[번역 익스텐션] 텍스트 컨테이너 탐색 오류:", error);
        return [];
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
        try {
          document.createDocumentFragment().querySelector(selector);
        } catch (selectorError) {
          console.warn(`[번역 익스텐션] 잘못된 선택자: ${selector}`, selectorError);
          return [];
        }
        
        return document.querySelectorAll(selector);
      } catch (error) {
        console.error('[번역 익스텐션] 요소 검색 오류:', error);
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
        try {
          document.createDocumentFragment().querySelector(selector);
        } catch (selectorError) {
          console.warn(`[번역 익스텐션] 잘못된 선택자: ${selector}`, selectorError);
          return null;
        }
        
        return document.querySelector(selector);
      } catch (error) {
        console.error('[번역 익스텐션] 요소 검색 오류:', error);
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
        
        console.log(`[번역 익스텐션] 전체 페이지에서 ${textNodes.length}개 텍스트 노드 추출됨`);
      } catch (error) {
        console.error('[번역 익스텐션] 전체 텍스트 노드 추출 오류:', error);
      }
      
      return textNodes;
    }
    
    /**
     * 설정 업데이트
     * @param {Object} newSettings - 새 설정 값
     */
    function updateSettings(newSettings) {
      try {
        if (!newSettings) return;
        settings = { ...settings, ...newSettings };
      } catch (error) {
        console.error('[번역 익스텐션] 설정 업데이트 오류:', error);
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
     */
    function resetAllTranslationAttributes() {
      try {
        // 번역된 요소 데이터 속성 제거
        document.querySelectorAll(`[${settings.translatedAttr}]`).forEach(element => {
          try {
            if (element && element.removeAttribute) {
              element.removeAttribute(settings.translatedAttr);
            }
          } catch (attrError) {
            console.warn('[번역 익스텐션] 속성 제거 오류:', attrError);
          }
        });
        
        // 대기 중인 요소 데이터 속성 제거
        document.querySelectorAll(`[${settings.pendingAttr}]`).forEach(element => {
          try {
            if (element && element.removeAttribute) {
              element.removeAttribute(settings.pendingAttr);
            }
          } catch (attrError) {
            console.warn('[번역 익스텐션] 속성 제거 오류:', attrError);
          }
        });
        
        // 소스 텍스트 데이터 속성 제거
        document.querySelectorAll(`[${settings.sourceAttr}]`).forEach(element => {
          try {
            if (element && element.removeAttribute) {
              element.removeAttribute(settings.sourceAttr);
            }
          } catch (attrError) {
            console.warn('[번역 익스텐션] 속성 제거 오류:', attrError);
          }
        });
        
        console.log('[번역 익스텐션] 모든 번역 속성 초기화 완료');
      } catch (error) {
        console.error('[번역 익스텐션] 번역 속성 초기화 오류:', error);
      }
    }

        // dom-selector.js 파일 수정
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
                console.warn(`[번역 익스텐션] 복잡한 선택자 검증 실패: ${selector}`, e);
                return false;
                }
            }
            
            // 기본 검증
            document.createDocumentFragment().querySelector(selector);
            return true;
        } catch (error) {
            console.warn(`[번역 익스텐션] 유효하지 않은 선택자: ${selector}`, error);
            return false;
        }
    }

    // matches 함수 호출을 안전하게 보호
    function safeMatches(element, selector) {
        if (!element || !element.matches || !isValidSelector(selector)) {
            return false;
        }
        
        try {
            return element.matches(selector);
        } catch (error) {
            console.warn("[번역 익스텐션] matches 함수 오류:", error);
            return false;
        }
    }
  
        // hasParentMatching 함수 수정
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
            console.error("[번역 익스텐션] 부모 노드 확인 오류:", error);
            return false;
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
      resetAllTranslationAttributes
    };
  })();
  
  // 모듈 내보내기
  window.DOMSelector = DOMSelector;