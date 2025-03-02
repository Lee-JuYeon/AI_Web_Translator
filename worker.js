// Cloudflare Worker 코드 (worker.js)

/**
 * Gemini API를 프록시하는 Cloudflare Worker
 * 클라이언트는 API 키 없이 이 엔드포인트에 요청하며,
 * Worker가 실제 Gemini API에 API 키를 포함하여 요청합니다.
 */

// 환경 변수로 API 키 설정 (Cloudflare Workers 대시보드에서 설정)
// 실제 사용 시에는 대시보드의 "Variables" 탭에서 GEMINI_API_KEY를 설정해야 합니다.

const GEMINI_API_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  // CORS 헤더 설정
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*', // 실제 서비스에서는 특정 도메인으로 제한
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  // OPTIONS 요청(preflight) 처리
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  // POST 요청만 허용
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: corsHeaders
    });
  }

  try {
    // 요청 본문 파싱
    const requestData = await request.json();

    // 필수 파라미터 확인
    if (!requestData.texts || !Array.isArray(requestData.texts)) {
      return new Response(JSON.stringify({
        error: 'texts 파라미터가 필요합니다 (배열 형식)'
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }

    // 선택적 파라미터 설정
    const targetLang = requestData.targetLang || 'ko';
    const separator = requestData.separator || "||TRANSLATE_SEPARATOR||";
    
    // Gemini API 요청 데이터 구성
    const texts = requestData.texts;
    const joinedTexts = texts.join(separator);
    
    // Gemini API 프롬프트 구성
    const promptText = `다음 텍스트들을 ${targetLang === 'ko' ? '한국어' : targetLang}로 자연스럽게 번역해주세요.
각 텍스트는 '${separator}' 구분자로 분리되어 있습니다.
번역 결과도 동일한 구분자로 분리해서 반환해주세요.
원래 텍스트 수와 번역된 텍스트 수가 정확히 일치해야 합니다.
번역만 제공하고 다른 설명은 하지 말아주세요.

${joinedTexts}`;

    // Gemini API 호출
    const geminiResponse = await fetch(`${GEMINI_API_ENDPOINT}?key=${GEMINI_API_KEY}`, {
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

    // Gemini API 응답 확인
    if (!geminiResponse.ok) {
      const errorData = await geminiResponse.json();
      return new Response(JSON.stringify({
        error: `Gemini API 오류: ${errorData.error?.message || geminiResponse.statusText}`
      }), {
        status: geminiResponse.status,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }

    // Gemini API 응답 데이터 파싱
    const geminiData = await geminiResponse.json();
    
    // 응답 텍스트 추출
    if (geminiData.candidates && geminiData.candidates.length > 0 && 
        geminiData.candidates[0].content && geminiData.candidates[0].content.parts) {
      
      const translatedText = geminiData.candidates[0].content.parts[0].text;
      const translations = translatedText.split(separator);
      
      // 결과 개수가 원본 개수와 같은지 확인
      if (translations.length !== texts.length) {
        console.log(`번역 결과 개수가 맞지 않습니다. 예상: ${texts.length}, 실제: ${translations.length}`);
        
        // 결과가 부족한 경우 원본으로 채움
        while (translations.length < texts.length) {
          translations.push(texts[translations.length]);
        }
        
        // 결과가 많은 경우 잘라냄
        if (translations.length > texts.length) {
          translations.splice(texts.length);
        }
      }
      
      // 빈 문자열 처리
      const finalTranslations = translations.map((text, index) => text.trim() || texts[index]);
      
      // 결과 반환
      return new Response(JSON.stringify({
        success: true,
        translations: finalTranslations
      }), {
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    } else {
      return new Response(JSON.stringify({
        error: "Gemini API에서 유효한 응답을 받지 못했습니다."
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      error: `서버 오류: ${error.message}`
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  }
}