using Amazon.Translate;
using Amazon.Translate.Model;
using TranslateDemo.Domain.Abstractions;

namespace TranslateDemo.Infrastructure.Translation;

public sealed class AwsTranslator : ITranslator
{
    private readonly IAmazonTranslate _client;

    public AwsTranslator(IAmazonTranslate client)
    {
        _client = client;
    }

    public async Task<string> TranslateAsync(string text, string sourceLanguage, string targetLanguage, CancellationToken ct = default)
    {
        var request = new TranslateTextRequest
        {
            Text = text,
            SourceLanguageCode = sourceLanguage == "auto" ? null : sourceLanguage,
            TargetLanguageCode = targetLanguage
        };
        var response = await _client.TranslateTextAsync(request, ct);
        return response.TranslatedText;
    }
}

