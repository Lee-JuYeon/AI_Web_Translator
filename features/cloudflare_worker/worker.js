// worker.js - 리팩토링 버전
/**
 * Gemini API를 프록시하는 Cloudflare Worker
 * - API 키 보호
 * - 캐싱으로 중복 요청 감소
 * - 속도 제한으로 API 남용 방지
 */

const GEMINI_API_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";
const MAX_REQUESTS_PER_MINUTE = 30; // 분당 최대 요청 수
const CACHE_TTL = 60 * 60 * 24 * 30; // 캐시 유효 기간 (30일)

// 최신 Cloudflare Workers 모듈 형식 사용
export default {
  async fetch(request, env, ctx) {
    return await handleRequest(request, env);
  }
};

/**
 * 요청 처리 함수
 * @param {Request} request - 클라이언트 요청 객체
 * @param {Object} env - Cloudflare Workers 환경 변수
 * @returns {Response} - 응답 객체
 */
async function handleRequest(request, env) {
  // CORS 헤더 설정
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*', // 실제 서비스에서는 특정 도메인으로 제한
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  // 요청 메서드에 따른 처리
  switch (request.method) {
    case 'OPTIONS':
      // OPTIONS 요청(preflight) 처리
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    
    case 'POST':
      // POST 요청 처리
      return await handlePostRequest(request, env, corsHeaders);
    
    default:
      // 지원하지 않는 메서드
      return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
        status: 405,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
  }
}

/**
 * POST 요청 처리 함수
 * @param {Request} request - 클라이언트 요청 객체
 * @param {Object} env - Cloudflare Workers 환경 변수
 * @param {Object} corsHeaders - CORS 헤더
 * @returns {Response} - 응답 객체
 */
async function handlePostRequest(request, env, corsHeaders) {
  try {
    // 요청 본문 파싱
    const requestData = await request.json();

    // 파라미터 검증
    if (!validateRequestData(requestData)) {
      return new Response(JSON.stringify({
        error: 'texts 파라미터가 필요합니다 (배열 형식)'
      }), {
        status: 400,
        headers: getResponseHeaders(corsHeaders)
      });
    }

    // 속도 제한 검사
    const rateLimitResult = await checkRateLimit(request, env);
    if (!rateLimitResult.allowed) {
      return new Response(JSON.stringify({
        error: '요청 한도 초과. 잠시 후 다시 시도하세요.'
      }), { 
        status: 429,
        headers: getResponseHeaders(corsHeaders)
      });
    }

    // 선택적 파라미터 설정
    const targetLang = requestData.targetLang || 'ko';
    const separator = requestData.separator || "||TRANSLATE_SEPARATOR||";
    
    // Gemini API 요청 데이터 구성
    const texts = requestData.texts;
    const joinedTexts = texts.join(separator);
    
    // 캐시 키 생성 및 캐시 확인
    const cacheKey = `${targetLang}:${computeHash(joinedTexts)}`;
    const cachedResult = await getCachedResult(env, cacheKey);
    
    if (cachedResult) {
      console.log('캐시 히트:', cacheKey);
      return new Response(cachedResult, {
        headers: getResponseHeaders(corsHeaders)
      });
    }
    
    // API 키 확인
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({
        error: 'API 키가 설정되지 않았습니다.'
      }), {
        status: 500,
        headers: getResponseHeaders(corsHeaders)
      });
    }

    // Gemini API 호출
    const geminiResponse = await callGeminiApi(apiKey, joinedTexts, targetLang, separator);

    // Gemini API 응답 확인
    if (!geminiResponse.ok) {
      const errorData = await geminiResponse.json();
      return new Response(JSON.stringify({
        error: `Gemini API 오류: ${errorData.error?.message || geminiResponse.statusText}`
      }), {
        status: geminiResponse.status,
        headers: getResponseHeaders(corsHeaders)
      });
    }

    // 응답 처리
    const result = await processGeminiResponse(geminiResponse, texts, separator);
    
    // 결과 생성
    const responseData = JSON.stringify({
      success: true,
      translations: result.translations
    });
    
    // 캐시에 저장
    if (env.TRANSLATION_CACHE) {
      await env.TRANSLATION_CACHE.put(cacheKey, responseData, {expirationTtl: CACHE_TTL});
    }
    
    // 결과 반환
    return new Response(responseData, {
      headers: getResponseHeaders(corsHeaders)
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: `서버 오류: ${error.message}`
    }), {
      status: 500,
      headers: getResponseHeaders(corsHeaders)
    });
  }
}

/**
 * 요청 데이터 유효성 검사
 * @param {Object} requestData - 요청 데이터
 * @returns {boolean} - 유효성 여부
 */
function validateRequestData(requestData) {
  return requestData && 
         requestData.texts && 
         Array.isArray(requestData.texts);
}

/**
 * 응답 헤더 생성
 * @param {Object} corsHeaders - CORS 헤더
 * @returns {Object} - 응답 헤더
 */
function getResponseHeaders(corsHeaders) {
  return {
    'Content-Type': 'application/json',
    ...corsHeaders
  };
}

/**
 * 속도 제한 검사
 * @param {Request} request - 클라이언트 요청 객체
 * @param {Object} env - Cloudflare Workers 환경 변수
 * @returns {Object} - 검사 결과 객체 {allowed: boolean}
 */
async function checkRateLimit(request, env) {
  // KV 네임스페이스가 없으면 제한 없음
  if (!env.RATE_LIMITS) {
    return { allowed: true };
  }
  
  const IP = request.headers.get('CF-Connecting-IP');
  const rateLimitKey = `ratelimit:${IP}`;
  
  // 현재 카운트 가져오기
  const currentCount = parseInt(await env.RATE_LIMITS.get(rateLimitKey) || '0');
  
  // 한도 초과 검사
  if (currentCount > MAX_REQUESTS_PER_MINUTE) {
    return { allowed: false };
  }
  
  // 요청 카운터 증가
  await env.RATE_LIMITS.put(rateLimitKey, (currentCount + 1).toString(), {expirationTtl: 60});
  
  return { allowed: true };
}

/**
 * 캐시된 결과 가져오기
 * @param {Object} env - Cloudflare Workers 환경 변수
 * @param {string} cacheKey - 캐시 키
 * @returns {string|null} - 캐시된 결과 또는 null
 */
async function getCachedResult(env, cacheKey) {
  if (env.TRANSLATION_CACHE) {
    return await env.TRANSLATION_CACHE.get(cacheKey);
  }
  return null;
}

/**
 * Gemini API 호출
 * @param {string} apiKey - Gemini API 키
 * @param {string} joinedTexts - 결합된 텍스트
 * @param {string} targetLang - 대상 언어
 * @param {string} separator - 구분자
 * @returns {Response} - API 응답
 */
async function callGeminiApi(apiKey, joinedTexts, targetLang, separator) {
  // Gemini API 프롬프트 구성
  const promptText = `다음 텍스트들을 ${targetLang === 'ko' ? '한국어' : targetLang}로 자연스럽게 번역해주세요.
각 텍스트는 '${separator}' 구분자로 분리되어 있습니다.
번역 결과도 동일한 구분자로 분리해서 반환해주세요.
원래 텍스트 수와 번역된 텍스트 수가 정확히 일치해야 합니다.
번역만 제공하고 다른 설명은 하지 말아주세요.

${joinedTexts}`;

  return await fetch(`${GEMINI_API_ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: promptText
        }]
      }],
      generationConfig: {
        temperature: 0.1,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192
      }
    })
  });
}

/**
 * Gemini API 응답 처리
 * @param {Response} geminiResponse - Gemini API 응답
 * @param {string[]} originalTexts - 원본 텍스트 배열
 * @param {string} separator - 구분자
 * @returns {Object} - 처리된 결과 객체
 */
async function processGeminiResponse(geminiResponse, originalTexts, separator) {
  const geminiData = await geminiResponse.json();
  
  // 응답 텍스트 추출
  if (geminiData.candidates && 
      geminiData.candidates.length > 0 && 
      geminiData.candidates[0].content && 
      geminiData.candidates[0].content.parts) {
    
    const translatedText = geminiData.candidates[0].content.parts[0].text;
    const translations = translatedText.split(separator);
    
    // 결과 개수 처리
    let finalTranslations = translations;
    
    if (translations.length !== originalTexts.length) {
      console.log(`번역 결과 개수가 맞지 않습니다. 예상: ${originalTexts.length}, 실제: ${translations.length}`);
      
      // 결과 개수 맞추기
      finalTranslations = matchTranslationsCount(translations, originalTexts);
    }
    
    // 빈 문자열 처리
    const cleanedTranslations = finalTranslations.map((text, index) => 
      text.trim() || originalTexts[index]
    );
    
    return { translations: cleanedTranslations };
  } else {
    throw new Error("Gemini API에서 유효한 응답을 받지 못했습니다.");
  }
}

/**
 * 번역 결과와 원본 개수 맞추기
 * @param {string[]} translations - 번역 결과 배열
 * @param {string[]} originalTexts - 원본 텍스트 배열
 * @returns {string[]} - 개수를 맞춘 번역 결과 배열
 */
function matchTranslationsCount(translations, originalTexts) {
  // 결과가 부족한 경우 원본으로 채움
  if (translations.length < originalTexts.length) {
    const result = [...translations];
    for (let i = translations.length; i < originalTexts.length; i++) {
      result.push(originalTexts[i]);
    }
    return result;
  }
  
  // 결과가 많은 경우 잘라냄
  if (translations.length > originalTexts.length) {
    return translations.slice(0, originalTexts.length);
  }
  
  return translations;
}

/**
 * 문자열에 대한 간단한 해시 생성 (캐시 키용)
 * @param {string} str - 해시 생성할 문자열
 * @returns {string} - 생성된 해시 값
 */
function computeHash(str) {
  let hash = 0;
  if (str.length === 0) return hash.toString(36);
  
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // 32비트 정수로 변환
  }
  
  return hash.toString(36); // 짧은 문자열로 변환
}