' Liga o painel em segundo plano (sem janela) e, com o argumento "abrir", abre o navegador.
Set sh = CreateObject("WScript.Shell")
pasta = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.Run """" & pasta & "\painel-servico.cmd""", 0, False
If WScript.Arguments.Count > 0 Then
  If WScript.Arguments(0) = "abrir" Then
    WScript.Sleep 2500
    sh.Run "http://localhost:3333"
  End If
End If
