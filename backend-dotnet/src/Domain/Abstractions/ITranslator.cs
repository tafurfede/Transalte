namespace TranslateDemo.Domain.Abstractions;

public interface ITranslator
{
    Task<string> TranslateAsync(string text, string sourceLanguage, string targetLanguage, CancellationToken ct = default);
}

