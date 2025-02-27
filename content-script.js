// 백그라운드 스크립트로부터 메시지 수신
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "translatePage") {
    translatePage();
    return true;
  } else if (request.action === "updateTranslatedTexts") {
    replaceTextsInDOM(request.translatedTexts);
    return true;
  }
});

/**
 * 1. 웹페이지 전체를 가져와 번역 프로세스 시작
 * 2. 자연어 텍스트만 추출
 * 3. 리스트에 [원본텍스트, 번역될 텍스트, 위치정보(xpath로 위치정보 저장)] 저장
 * 4. 리스트를 백그라운드로 전송하여 AI 번역 요청
 */
function translatePage() {
  console.log("[번역 익스텐션] 페이지 번역 시작");
  
  // 1. HTML 문서 전체 참조
  // (참고: document 객체를 직접 사용하므로 별도 문자열로 저장하지 않음)
  
  // 2. 자연어 텍스트 추출
  const textNodes = extractTextNodes(document.body);
  console.log(`[번역 익스텐션] 추출된 텍스트 노드: ${textNodes.length}개`);
  
  // 3. 텍스트 정보 리스트 생성 [원본텍스트, 빈칸(번역될 공간), 위치정보]
  const textList = [];
  
  textNodes.forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) { // text_node = 텍스트 노드
      const text = node.textContent.trim();
      if (text) {
        // XPath로 위치 정보 저장
        const xpath = getXPathForNode(node);

        const beforeTranslateText = text;
        const afterTranslateText = "";
        const textTagPosition = xpath;
        textList.push(
          [beforeTranslateText, afterTranslateText, textTagPosition]
        );

        console.log(`✍🏻번역 이전 텍스트: ${beforeTranslateText}
          xpath 위치: ${textTagPosition}`);
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) { // elemt_node = 모든 태그
      // 속성에 있는 텍스트 (alt, title, placeholder 등)
      ['title', 'alt', 'placeholder', 'value'].forEach(attr => {
        if (node.hasAttribute(attr) && node.getAttribute(attr).trim()) {
          const attrValue = node.getAttribute(attr);
          const attrInfo = `${getXPathForElement(node)}|attr:${attr}`;
          textList.push([attrValue, "", attrInfo]);

          console.log(`🐬번역 이전 텍스트: ${attrValue}
            xpath 위치: ${attrInfo}`);
        }
      });
    }
  });
  
  console.log(`[번역 익스텐션] 번역할 텍스트 항목: ${textList.length}개`);
  
  // 4. 리스트를 백그라운드 스크립트로 전송하여 AI 번역 요청
  if (textList.length > 0) {
    chrome.runtime.sendMessage({
      action: "translateTexts",
      textList: textList
    }, response => {
      if (response && response.success) {
        console.log("[번역 익스텐션] 번역 요청 성공");
      } else {
        console.error("[번역 익스텐션] 번역 요청 실패:", response ? response.error : "응답 없음");
      }
    });
  } else {
    console.log("[번역 익스텐션] 번역할 텍스트가 없습니다.");
  }
}

/**
 * 2. DOM에서 텍스트 노드 추출
 */
function extractTextNodes(element) {
  const textNodes = [];
  
  // TreeWalker를 사용하여 텍스트 노드와 특정 속성을 가진 요소 노드 탐색
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    {
      acceptNode: function(node) {
        // 스크립트, 스타일, 숨겨진 요소 내 텍스트는 제외
        if (node.parentNode) {
          const parentTag = node.parentNode.tagName ? node.parentNode.tagName.toLowerCase() : '';
          if (parentTag === 'script' || parentTag === 'style' || parentTag === 'noscript' || 
              parentTag === 'code' || parentTag === 'pre') {
            return NodeFilter.FILTER_REJECT;
          }
          
          // CSS로 숨겨진 요소 제외
          if (node.parentNode.nodeType === Node.ELEMENT_NODE) {
            const style = window.getComputedStyle(node.parentNode);
            if (style.display === 'none' || style.visibility === 'hidden') {
              return NodeFilter.FILTER_REJECT;
            }
          }
        }
        
        // 텍스트 노드이고 내용이 있는 경우
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent.trim();
          if (text.length > 0) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_SKIP;
        }
        
        // 특정 속성(title, alt, placeholder 등)을 가진 요소 노드
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.hasAttribute('title') || node.hasAttribute('alt') || 
              node.hasAttribute('placeholder') || 
              (node.tagName === 'INPUT' && node.type !== 'password' && node.hasAttribute('value'))) {
            return NodeFilter.FILTER_ACCEPT;
          }
        }
        
        return NodeFilter.FILTER_SKIP;
      }
    }
  );
  
  // TreeWalker로 노드 탐색
  let node;
  while (node = walker.nextNode()) {
    textNodes.push(node);
  }
  
  return textNodes;
}

/**
 * 3. 텍스트 노드의 XPath 생성 (위치 정보)
 */
function getXPathForNode(node) {
  // 텍스트 노드인 경우 부모 요소의 XPath + 텍스트 노드 인덱스
  if (node.nodeType === Node.TEXT_NODE) {
    const parent = node.parentNode;
    const siblings = Array.from(parent.childNodes);
    const textNodeIndex = siblings.filter(n => n.nodeType === Node.TEXT_NODE).indexOf(node);
    return getXPathForElement(parent) + '/text()[' + (textNodeIndex + 1) + ']';
  }
  
  return getXPathForElement(node);
}

/**
 * 3. 요소의 XPath 생성 (위치 정보)
 */
function getXPathForElement(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }
  
  // 문서 루트인 경우
  if (element === document.documentElement) {
    return '/html';
  }
  
  // 부모 요소가 없는 경우
  if (!element.parentNode) {
    return '';
  }
  
  // ID가 있는 경우 (고유 식별자)
  if (element.id) {
    return '//*[@id="' + element.id + '"]';
  }
  
  // 부모 요소의 XPath + 현재 요소 태그 및 위치
  const siblings = Array.from(element.parentNode.children).filter(e => e.tagName === element.tagName);
  
  if (siblings.length === 1) {
    return getXPathForElement(element.parentNode) + '/' + element.tagName.toLowerCase();
  }
  
  const index = siblings.indexOf(element) + 1;
  return getXPathForElement(element.parentNode) + '/' + element.tagName.toLowerCase() + '[' + index + ']';
}

/**
 * 5. 번역된 텍스트를 DOM에 적용
 */
function replaceTextsInDOM(translatedTexts) {
  console.log(`[번역 익스텐션] ${translatedTexts.length}개 텍스트 교체 시작`);
  
  let replacedCount = 0;
  translatedTexts.forEach(item => {
    try {
      const [originalText, translatedText, locationInfo] = item;
      
      // 번역되지 않았거나 원본과 동일한 텍스트는 건너뜀
      if (!translatedText || originalText === translatedText) {
        return;
      }
      
      // 속성인 경우 (xpath|attr:속성명)
      if (locationInfo.includes('|attr:')) {
        const [xpath, attrInfo] = locationInfo.split('|attr:');
        const attrName = attrInfo;
        const element = getElementByXPath(xpath);
        
        if (element && element.hasAttribute(attrName)) {
          element.setAttribute(attrName, translatedText);
          replacedCount++;
        }
      } 
      // 텍스트 노드인 경우
      else {
        const textNode = getElementByXPath(locationInfo);
        if (textNode && textNode.nodeType === Node.TEXT_NODE) {
          textNode.textContent = translatedText;
          replacedCount++;
        }
      }
    } catch (error) {
      console.error("[번역 익스텐션] 텍스트 교체 오류:", error);
    }
  });
  
  console.log(`[번역 익스텐션] ${replacedCount}개 텍스트 교체 완료`);
}

/**
 * 5. XPath로 요소 찾기
 */
function getElementByXPath(xpath) {
  try {
    return document.evaluate(
      xpath, 
      document, 
      null, 
      XPathResult.FIRST_ORDERED_NODE_TYPE, 
      null
    ).singleNodeValue;
  } catch (e) {
    console.error('[번역 익스텐션] XPath 평가 오류:', e, xpath);
    return null;
  }
}


// // 코드 관련 태그와 클래스 감지
// const codeTags = ['PRE', 'CODE', 'SAMP', 'KBD', 'VAR'];

// // 코드 블록 관련 클래스 및 패턴 확인 함수
// function isCodeContainer(element) {
//   if (!element) return false;
  
//   // 태그 이름으로 확인
//   if (codeTags.includes(element.nodeName)) return true;
  
//   // 코드 관련 클래스 확인
//   const codeClasses = [
//     'code', 'highlight', 'syntax', 'prettyprint', 'hljs', 'language-', 
//     'lang-', 'brush:', 'gist', 'codeblock', 'sourceCode', 'CodeMirror',
//     'cm-', 'token', 'linenums', 'rainbow', 'ace_', 'ace-', 'prism',
//     'wp-block-code', 'syntax-highlighter'
//   ];
  
//   if (element.className && typeof element.className === 'string') {
//     for (const className of codeClasses) {
//       if (element.className.includes(className)) return true;
//     }
//   }
  
//   // 특정 사이트 코드 컨테이너 확인
//   if (element.classList && 
//       (element.classList.contains('blob-code') || 
//        element.classList.contains('js-file-line') || 
//        element.classList.contains('snippet-code') || 
//        element.classList.contains('linenums'))) { 
//     return true;
//   }
  
//   // 직계 부모가 <pre> 태그인 <code> 태그도 코드 블록으로 간주
//   if (element.nodeName === 'CODE' && element.parentNode && element.parentNode.nodeName === 'PRE') {
//     return true;
//   }
  
//   // data-* 속성으로 확인
//   if (element.nodeType === Node.ELEMENT_NODE && element.getAttribute && 
//       (element.getAttribute('data-lang') || 
//        element.getAttribute('data-language') ||
//        element.getAttribute('data-syntaxhighlight') ||
//        element.getAttribute('data-code-example'))) {
//     return true;
//   }
  
//   return false;
// }

// // XML/HTML 코드 패턴 감지
// function isXmlHtmlPattern(text) {
//   // XML 선언
//   if (text.includes('<?xml') || text.includes('<!DOCTYPE')) return true;
  
//   // HTML/XML 태그 패턴
//   const xmlPatterns = [
//     /^<[a-zA-Z][a-zA-Z0-9]*(\s+[a-zA-Z][a-zA-Z0-9]*=("[^"]*"|'[^']*'))*\s*\/?>/,
//     /^<\/[a-zA-Z][a-zA-Z0-9]*\s*>/,
//     /^<.*?>.*?<\/.*?>/, 
//     /^<(androidx|android|com\.google|[a-z]+)(\.[a-z]+)+/i
//   ];
  
//   for (const pattern of xmlPatterns) {
//     if (pattern.test(text.trim())) return true;
//   }
  
//   // Android 특정 XML 패턴
//   if (text.includes('android:') || 
//       text.includes('app:') ||
//       text.includes('tools:') ||
//       text.includes('xmlns:')) {
//     return true;
//   }
  
//   return false;
// }

// // 코드 조각 패턴 감지 (다양한 프로그래밍 언어)
// function isCodeSnippet(text) {
//   // 명확한 코드 패턴만 감지하도록 수정
//   const codePatterns = [
//     // JavaScript, TypeScript, Java, C#, C/C++
//     /^(var|let|const|function|class)\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*[({=]/,
//     /^(public|private|protected|static|final)\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*[({;=]/,
//     /^import\s+[a-zA-Z_$*][a-zA-Z0-9_$.]*\s+from\s+['"][^'"]+['"];?$/,
//     /^[a-zA-Z_$][a-zA-Z0-9_$]*\([^)]*\)\s*{/,  // 함수 선언
    
//     // Python
//     /^def\s+[a-zA-Z0-9_]+\(/,
//     /^from\s+[a-zA-Z0-9_.]+\s+import\s+/,
//     /^class\s+[a-zA-Z0-9_]+(\([a-zA-Z0-9_]+\))?:/,
    
//     // 주석 (코드 내 주석은 코드로 취급)
//     /^\s*\/\/\s*[A-Za-z0-9]/,  // JavaScript, Java 등의 주석
//     /^\s*#\s*[A-Za-z0-9]/,  // Python, Ruby 등의 주석
//   ];
  
//   for (const pattern of codePatterns) {
//     if (pattern.test(text)) return true;
//   }
  
//   return false;
// }

// // 유니코드 이스케이프 문자열을 실제 문자로 변환
// function decodeUnicodeEscapes(text) {
//   return text.replace(/\\u([0-9a-fA-F]{4})/g, (match, hex) => {
//     return String.fromCharCode(parseInt(hex, 16));
//   });
// }

// // 블로그 내 코드 블록 컨테이너 감지 및 마킹
// function detectBlogCodeContainers() {
//   const potentialCodeSelectors = [
//     'pre code', '.wp-block-code', '.code-block', 
//     '.highlight', 'pre.line-numbers', 'code.language-*',
//     'pre.prettyprint', '.prism-highlight'
//   ];
  
//   const codeContainers = [];
  
//   potentialCodeSelectors.forEach(selector => {
//     try {
//       const elements = document.querySelectorAll(selector);
//       elements.forEach(el => {
//         codeContainers.push(el);
//         // 코드 블록 전체를 마킹
//         el.setAttribute('data-code-example', 'true');
        
//         // 코드 블록 내부의 모든 텍스트 노드도 마킹
//         const textWalker = document.createTreeWalker(
//           el, NodeFilter.SHOW_TEXT,
//           { acceptNode: () => NodeFilter.FILTER_ACCEPT }
//         );
        
//         while (textWalker.nextNode()) {
//           const node = textWalker.currentNode;
//           node.isCodeExample = true;
//         }
//       });
//     } catch (e) {
//       // 복잡한 선택자 오류 무시
//     }
//   });
  
//   return codeContainers;
// }

// // CSS 패턴 확인 함수
// function isCSSPattern(text) {
//   // CSS 클래스/ID 선택자로 시작
//   if (text.startsWith('.') || text.startsWith('#')) return true;
  
//   // 중괄호로 감싸진 스타일 블록
//   if (text.includes('{') && text.includes('}')) return true;
  
//   // 일반적인 CSS 속성들
//   const cssProperties = [
//     'color:', 'background', 'margin:', 'padding:', 'border:',
//     'width:', 'height:', 'position:', 'display:', 'font-',
//     'text-', 'align', 'opacity:', 'flex', 'grid', 'transform:',
//     'transition:', 'animation:', 'fill:', 'stroke:'
//   ];
  
//   for (const prop of cssProperties) {
//     if (text.includes(prop)) return true;
//   }
  
//   // 세미콜론으로 구분된 여러 스타일 선언
//   if (text.includes(';') && (text.includes(':') || 
//      text.match(/\s+\d+(\.\d+)?(px|em|rem|%|vh|vw|pt|pc)/))) {
//     return true;
//   }
  
//   return false;
// }

// // 에러 메시지 패턴 확인 함수 - 더 제한적으로 변경
// function isErrorMessage(text) {
//   const errorPatterns = [
//     /is not defined$/i, 
//     /is not a function$/i, 
//     /cannot read property/i,
//     /is null or not an object/i, 
//     /uncaught exception/i,
//     /failed to load/i
//   ];
  
//   for (const pattern of errorPatterns) {
//     if (pattern.test(text)) return true;
//   }
  
//   return false;
// }

// // 자연어 텍스트 판별 함수 - 더 포괄적으로 변경
// function isNaturalLanguageText(text) {
//   // 기술적 패턴 체크
//   if (isCSSPattern(text) || isErrorMessage(text)) return false;
  
//   // 한글이 포함된 텍스트는 자연어로 간주
//   if (/[\uAC00-\uD7A3]/.test(text)) return true;
  
//   // 단어 수 확인 - 더 완화된 기준 적용
//   const words = text.split(/\s+/).filter(w => w.length > 0);
  
//   // 완화된 자연어 판별 기준
//   if (words.length >= 2 && text.length >= 5) return true;
  
//   // 기술 용어는 항상 번역 제외 - 정확한 일치 확인
//   const techKeywords = ['function', 'variable', 'method', 'object', 'property', 
//                         'class', 'event', 'element', 'attribute'];
//   if (techKeywords.includes(text.toLowerCase().trim())) return false;
  
//   // 문장 부호 포함시 자연어로 간주
//   if (/[.,:;?!]/.test(text) && text.length >= 5) return true;
  
//   // 제목 패턴은 자연어
//   if (/[A-Z][a-z]+ [A-Z][a-z]+/.test(text)) return true;
  
//   return false;
// }

// // 번역할 텍스트 판별 함수 - 더 많은 텍스트를 번역 대상으로 포함
// function isTranslatableText(text) {
//   // 유니코드 처리
//   let processedText = text;
//   if (text.includes('\\u')) {
//     processedText = decodeUnicodeEscapes(text);
//   }

//   // 기본 검사: 빈 텍스트 제외
//   if (!text || text.trim().length < 2) return false;
  
//   // 명확한 코드 패턴만 제외
//   if (isXmlHtmlPattern(processedText) || isCodeSnippet(processedText)) return false;
  
//   // 필수 패턴 필터링 - 최소화된 목록
//   const skipPatterns = [
//     /^https?:\/\//i,                           // URL
//     /\.(js|css|svg|png|jpg|jpeg|gif|webp)$/i,  // 파일 확장자
//     /^#[0-9a-fA-F]{3,8}$/,                     // 색상 코드
//     /^[A-Z0-9]{10,}$/                          // 토큰이나 ID로 보이는 패턴
//   ];
  
//   for (const pattern of skipPatterns) {
//     if (pattern.test(text)) return false;
//   }
  
//   // JSON 객체 패턴 제외
//   if ((text.startsWith('{') && text.endsWith('}')) || 
//       (text.startsWith('[') && text.endsWith(']'))) {
//     return false;
//   }
  
//   // HTML 태그만 제외 - 더 엄격한 패턴
//   if (/^<[a-z][^>]*>$/i.test(text)) return false;
  
//   // 자연어 텍스트로 판단되면 번역 대상
//   return isNaturalLanguageText(text);
// }

// // 문장 단위로 텍스트 추출 - 새로 추가된 함수
// function extractSentences(element) {
//   if (!element || !element.textContent) return [];
  
//   const fullText = element.textContent.trim();
//   if (fullText.length < 3) return [];
  
//   // 명확한 코드 블록은 통째로 처리
//   if (isCodeContainer(element)) {
//     return [{
//       text: fullText,
//       node: element,
//       isCodeBlock: true
//     }];
//   }
  
//   // 문장 단위로 분리
//   const sentences = [];
//   const sentencePattern = /([^.!?]+[.!?]+)|([^.!?]+$)/g;
//   let match;
  
//   // 문장 단위로 추출
//   while ((match = sentencePattern.exec(fullText)) !== null) {
//     const sentence = match[0].trim();
//     if (sentence.length > 2 && isTranslatableText(sentence)) {
//       sentences.push({
//         text: sentence,
//         node: element,
//         isCodeBlock: false
//       });
//     }
//   }
  
//   // 문장으로 나눠지지 않는 경우 전체를 하나의 단위로
//   if (sentences.length === 0 && isTranslatableText(fullText)) {
//     sentences.push({
//       text: fullText,
//       node: element,
//       isCodeBlock: false
//     });
//   }
  
//   return sentences;
// }

// // 스크립트 태그에서 UI 텍스트 추출 함수
// function extractUITextFromScript(scriptContent) {
//   const result = [];
  
//   // 문자열 리터럴 추출 (작은따옴표, 큰따옴표, 백틱)
//   const stringPattern = /(['"`])((?:\\.|[^\\])*?)\1/g;
//   let match;
  
//   while ((match = stringPattern.exec(scriptContent)) !== null) {
//     const stringContent = match[2].trim();
    
//     if (stringContent.length >= 5 && isTranslatableText(stringContent)) {
//       result.push(stringContent);
//     }
//   }
  
//   return result;
// }

// // 전체 텍스트 노드 탐색 함수 - 문장 단위 처리로 개선
// function getTextNodes() {
//   console.log("🔍 텍스트 노드를 탐색하는 중...");
//   const nodes = [];

//   // 번역에서 제외할 태그 목록
//   const excludedTags = ['STYLE', 'META', 'LINK', 'SVG', 'PATH', 'CANVAS', 'SCRIPT', 'NOSCRIPT', 'IFRAME'];

//   // 1. 먼저 모든 스크립트 태그 처리
//   const scriptTags = document.querySelectorAll('script');
//   scriptTags.forEach(script => {
//     if (script.textContent && script.textContent.trim()) {
//       const uiTexts = extractUITextFromScript(script.textContent);
      
//       // 중복 제거 후 추가
//       const uniqueTexts = [...new Set(uiTexts)];
      
//       uniqueTexts.forEach(text => {
//         nodes.push({
//           element: script,
//           originalText: text,
//           isScriptString: true
//         });
//         console.log(`ℹ️ SCRIPT 내 UI 텍스트: ${text}`);
//       });
//     }
//   });

//   // 2. 코드 블록 처리 - 블록 단위로 보존
//   const codeBlocks = Array.from(document.querySelectorAll('pre, code, .code-block, pre code'));
//   codeBlocks.forEach(block => {
//     if (isCodeContainer(block) && block.textContent.trim()) {
//       nodes.push({
//         element: block,
//         originalText: block.textContent.trim(),
//         isCodeBlock: true
//       });
//       console.log(`ℹ️ 코드 블록: ${block.nodeName}, 길이: ${block.textContent.trim().length}자`);
//     }
//   });
  
//   // 3. 본문 텍스트 처리 - 문단 단위 추출
//   const contentElements = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, td, th, div, span, a, button, label');
//   contentElements.forEach(element => {
//     // 제외 태그 내부에 있는지 확인
//     let parent = element;
//     let skipElement = false;
    
//     while (parent) {
//       if (excludedTags.includes(parent.nodeName) || 
//           isCodeContainer(parent) ||
//           (parent.nodeType === Node.ELEMENT_NODE && 
//            parent.getAttribute && 
//            parent.getAttribute('data-code-example') === 'true')) {
//         skipElement = true;
//         break;
//       }
//       parent = parent.parentNode;
//     }
    
//     if (skipElement) return;
    
//     // 의미 있는 텍스트를 포함하는지 확인
//     if (element.textContent && element.textContent.trim().length >= 3) {
//       // 코드 블록인지 확인
//       if (isCodeContainer(element)) {
//         nodes.push({
//           element: element,
//           originalText: element.textContent.trim(),
//           isCodeBlock: true
//         });
//         console.log(`ℹ️ 코드 블록: ${element.nodeName}, 텍스트: ${element.textContent.trim().substring(0, 50)}${element.textContent.trim().length > 50 ? '...' : ''}`);
//       } else {
//         // 일반 텍스트는 문장 단위로 처리
//         const textContent = element.textContent.trim();
        
//         // isTranslatableText로 판단
//         if (isTranslatableText(textContent)) {
//           nodes.push({
//             element: element,
//             originalText: textContent,
//             isCodeBlock: false
//           });
//           console.log(`ℹ️ HTML태그: ${element.nodeName}, TEXT: ${textContent.substring(0, 50)}${textContent.length > 50 ? '...' : ''}`);
//         }
//       }
//     }
//   });

//   console.log(`✅ 텍스트 노드 탐색 완료: ${nodes.length}개`);
//   return nodes;
// }

// // Gemini API로 번역 요청 (배치 처리)
// async function translateTextWithGemini(textNodes) {
//   console.log("🌐 Gemini API에 번역 요청 중...");

//   const textArray = textNodes
//     .filter(node => !node.isCodeBlock && !node.isScriptString) // 코드 블록과 스크립트 문자열 제외
//     .map(node => node.originalText.replace(/\s+/g, ' ').trim());
  
//   if (textArray.length === 0) {
//     console.log("⚠️ 번역할 텍스트가 없습니다.");
//     return [];
//   }
  
//   const batchSize = 3;
//   let translatedTexts = [];

//   const controller = new AbortController();
//   const timeoutId = setTimeout(() => controller.abort(), 10000); // 10초 타임아웃

//   for (let i = 0; i < textArray.length; i += batchSize) {
//     const batch = textArray.slice(i, i + batchSize);

//     try {
//       const response = await fetch(window.GEMINI_API_URL, {
//         method: "POST",
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({
//           contents: batch.map(text => ({ parts: [{ text: `Translate to Korean: ${text}` }] }))
//         }),
//         signal: controller.signal,
//       });

//       clearTimeout(timeoutId);
//       console.log(`🔸 API 요청: 배치 ${i/batchSize + 1}/${Math.ceil(textArray.length/batchSize)}`);

//       if (!response.ok) {
//         const errorText = await response.text();
//         console.error(`API 오류: ${response.status} ${response.statusText}\n상세 응답: ${errorText}`);
//         throw new Error(`API 오류: ${response.statusText}`);
//       }

//       const data = await response.json();

//       if (data?.candidates?.length) {
//         data.candidates.forEach(candidate => {
//           const translatedText = candidate?.content?.parts?.[0]?.text?.trim();
//           if (translatedText) translatedTexts.push(translatedText);
//         });
//       }
//     } catch (error) {
//       console.error("⚠️ 번역 실패:", error);
//       translatedTexts.push(...batch.map(() => null));
//     }
//   }

//   console.log("✅ 번역 완료!");
//   return translatedTexts;
// }

// // 번역된 텍스트 적용 함수 - 코드 블록 보존 로직 강화
// function applyTranslatedText(textNodes, translatedTexts) {
//   console.log("🔄 번역된 텍스트를 적용하는 중...");

//   // 코드 블록과 스크립트 문자열 제외
//   const translatableNodes = textNodes.filter(node => !node.isCodeBlock && !node.isScriptString);
  
//   if (translatableNodes.length !== translatedTexts.length) {
//     console.error(`⚠️ 노드 수(${translatableNodes.length})와 번역 결과(${translatedTexts.length})가 일치하지 않습니다.`);
//   }

//   translatableNodes.forEach((node, index) => {
//     if (!node.element || !translatedTexts[index]) return;
    
//     if (node.element.nodeType === Node.ELEMENT_NODE) {
//       // 텍스트가 포함된 노드인 경우 - innerHTML 대신 textContent 사용
//       const originalText = node.originalText;
//       const translatedText = translatedTexts[index];
      
//       // 코드 블록이 아닌 경우만 번역 적용
//       if (!node.isCodeBlock && !isCodeContainer(node.element)) {
//         // childNodes가 하나뿐이고 그것이 텍스트 노드인 경우
//         if (node.element.childNodes.length === 1 && 
//             node.element.childNodes[0].nodeType === Node.TEXT_NODE &&
//             node.element.childNodes[0].nodeValue.trim() === originalText) {
//           node.element.childNodes[0].nodeValue = translatedText;
//         }
//         // 그 외의 경우 원본 텍스트를 찾아 대체
//         else {
//           replaceTextInElement(node.element, originalText, translatedText);
//         }
//       }
//     }
//   });

//   console.log("✅ 번역 적용 완료!");
// }

// // 요소 내에서 특정 텍스트 찾아 대체하는 함수
// function replaceTextInElement(element, originalText, translatedText) {
//   if (!element || !originalText || !translatedText) return;
  
//   // 텍스트 노드만 처리
//   const walker = document.createTreeWalker(
//     element, 
//     NodeFilter.SHOW_TEXT,
//     { acceptNode: node => node.nodeValue.includes(originalText) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT }
//   );
  
//   let node;
//   while (node = walker.nextNode()) {
//     // 코드 블록 내부인지 확인
//     let parent = node.parentNode;
//     let isInCodeBlock = false;
    
//     while (parent) {
//       if (isCodeContainer(parent)) {
//         isInCodeBlock = true;
//         break;
//       }
//       parent = parent.parentNode;
//     }
    
//     // 코드 블록이 아닌 경우에만 텍스트 교체
//     if (!isInCodeBlock) {
//       node.nodeValue = node.nodeValue.replace(originalText, translatedText);
//     }
//   }
// }

// // 전체 번역 실행 함수
// async function translatePage() {
//   console.log("🌍 전체 페이지 번역을 시작합니다...");

//   // 코드 블록 컨테이너 미리 감지
//   const codeContainers = detectBlogCodeContainers();
//   console.log(`📝 감지된 코드 블록 컨테이너: ${codeContainers.length}개`);
  
//   const textNodes = getTextNodes();
  
//   // 번역할 텍스트가 있는 경우
//   if (textNodes.length > 0) {
//     // const translatedTexts = await translateTextWithGemini(textNodes);
//     // applyTranslatedText(textNodes, translatedTexts);
//   }

//   console.log("✅ 모든 번역 작업 완료!");
// }


// // ✅ 1. HTML 태그를 유지하면서 텍스트 노드만 추출 (부모 노드와 위치 정보 포함)
// function getTextNodes() {
//   console.log("🔍 텍스트 노드를 추출하는 중...");
//   const nodes = [];
//   // const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
//   //   acceptNode: node => node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
//   // });
//   const walker = document.createTreeWalker(document, NodeFilter.SHOW_TEXT, {
//     // acceptNode: node => node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
//     acceptNode: node => {
//       if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
//       const parentTag = node.parentNode.tagName;
//       if (["INPUT", "TEXTAREA"].includes(parentTag)) return NodeFilter.FILTER_REJECT;
//       return NodeFilter.FILTER_ACCEPT;
//     }
//   });

//   while (walker.nextNode()) {
//     // nodes.push(walker.currentNode);

//     // 텍스트 노드와 함께 부모 노드와 위치 정보 저장ㅊ
//     nodes.push({ node: walker.currentNode, parentNode: walker.currentNode.parentNode });
//   }
//   console.log(`✅ 텍스트 노드 추출 완료: ${nodes.length} 개`);
//   return nodes;
// }

// // ✅ 2. 문단별로 텍스트 그룹화 (HTML 구조 유지, 각 문단의 부모 노드도 함께 저장)
// function groupTextNodes(nodes) {
//   console.log("🔄 문단별로 텍스트를 그룹화하는 중...");
//   const paragraphs = [];
//   let currentParagraph = [];

//   nodes.forEach(({ node, parentNode }) => {
//     if (["P", "DIV", "LI", "BLOCKQUOTE", "BR"].includes(parentNode.nodeName) || /[.?!]$/.test(node.nodeValue.trim())) {
//       if (currentParagraph.length > 0) {
//         paragraphs.push(currentParagraph);
//         currentParagraph = [];
//       }
//     }
//     currentParagraph.push({ node, parentNode });
//   });

//   if (currentParagraph.length > 0) {
//     paragraphs.push(currentParagraph);
//   }

//   console.log(`✅ 문단 그룹화 완료: ${paragraphs.length} 개`);
//   return paragraphs;
// }

// // ✅ 3. Gemini API를 통해 번역 수행
// async function translateText(paragraphs) {
//   console.log("🌐 Gemini API를 통해 번역을 요청하는 중...");
//   const textToTranslate = paragraphs.map(group => group.map(({ node }) => node.nodeValue).join(" ")).join("\n\n");

//   try {
//     const response = await fetch(window.GEMINI_API_URL, {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({
//         contents: [{
//           parts: [{
//             text: `Translate this English text to **natural Korean** while converting to Korean units: \n\n${textToTranslate}

// *주의사항*
// 1. 현지에서 사용되는 통화, 단위 등은 번역을 요청하는 국가에서 주로 사용하는 단위로 변환할 것.
// 2. 예: 달러 → 원화(금일 환율 기준), 인치 → cm, 에이커 → 평.`
//           }]
//         }]
//       })
//     });

//     if (!response.ok) throw new Error(`API 오류: ${response.statusText}`);
//     const data = await response.json();
    
//     console.log("✅ 번역 완료!");
//     return (data.candidates?.[0]?.content?.parts?.[0]?.text || "").split("\n\n");
//   } catch (error) {
//     console.error("⚠️ 번역 실패:", error);
//     return paragraphs.map(group => group.map(({ node }) => node.nodeValue).join(" ")); // 실패 시 원문 반환
//   }
// }

// // ✅ 4. 번역 적용 (길이 보정 포함)
// function applyTranslatedText(paragraphs, translatedTexts) {
//   console.log("🔄 번역된 텍스트를 적용하는 중...");
//   paragraphs.forEach((group, index) => {
//     let translatedText = translatedTexts[index] || "";
//     let textParts = translatedText.split(/(?<=[.?!])\s+/);

//     while (textParts.length < group.length) {
//       textParts.push("");
//     }

//     group.forEach(({ node }, idx) => {
//       node.nodeValue = textParts[idx] || node.nodeValue;
//     });
//   });
//   console.log("✅ 번역 적용 완료!");
// }

// // ✅ 5. 전체 번역 실행
// async function translatePage() {
//   console.log("🌍 번역을 시작합니다...");

//   const textNodes = getTextNodes();
//   const paragraphs = groupTextNodes(textNodes);

//   console.log("⚙️ 번역 준비 완료, Gemini API 호출 중...");
//   const translatedTexts = await translateText(paragraphs);

//   console.log("⚙️ 번역 결과 적용 중...");
//   applyTranslatedText(paragraphs, translatedTexts);

//   console.log("✅ 번역 완료!");
// }


// // ✅ 6. 메시지 리스너 설정
// chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
//   if (request.action === "translatePage") {
//     console.log("📥 번역 요청 수신: ", request.action);
//     translatePage().then(() => {
//       sendResponse({ success: true });
//     }).catch((error) => {
//       console.error("번역 실패:", error);
//       sendResponse({ success: false, message: error.message });
//     });
//     return true;
//   }
// });