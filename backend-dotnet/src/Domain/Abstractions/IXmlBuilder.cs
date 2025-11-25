namespace TranslateDemo.Domain.Abstractions;

public interface IXmlBuilder
{
    Task<XmlBuildResult> BuildAsync(ReportMetadata metadata, IReadOnlyList<Section> sections, CancellationToken ct = default);
}

public sealed record ReportMetadata(string Code, string Id, string Language);

public sealed record Section(string Title, List<string> Paragraphs);

public sealed record XmlBuildResult(byte[] Content, string ContentType, string FileName);
