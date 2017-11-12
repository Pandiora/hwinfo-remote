'*************************************************************
'Check if network is up
'*************************************************************
Option Explicit
Dim MyLoop,strComputer,objPing,objStatus
MyLoop = True
While MyLoop = True
    strComputer = "192.168.188.1"
    Set objPing = GetObject("winmgmts:{impersonationLevel=impersonate}!\\").ExecQuery _
    ("select * from Win32_PingStatus where address = '" & strComputer & "'")
    For Each objStatus in objPing
        If objStatus.Statuscode = 0 Then
            MyLoop = False
            Call MyProgram()
            WScript.quit
        End If
    Next
    WScript.Sleep 1000
Wend

Sub MyProgram()

    '*************************************************************
    'Map Network-Drive
    '*************************************************************
    'Dim objNetwork
    'Set objNetwork = WScript.CreateObject("WScript.Network")
    'objNetwork.MapNetworkDrive "M:", "\\WDMYCLOUD\public", "FALSE"
    'Set objNetwork = Nothing

    '*************************************************************
    'Run programs
    '*************************************************************
    Dim WshShell
    Set WshShell = WScript.CreateObject("WScript.Shell")
    'WshShell.Run """C:\Program Files (x86)\Steam\Steam.exe"" -silent", 0, False
    WshShell.Run """C:\Program Files\HWiNFO64\HWINFO64.exe""", 0, False
    WScript.Sleep 5000
    WshShell.Run """C:\Remote\RemoteSensorMonitor\Remote Sensor Monitor.exe""", 0, False
    Set WshShell = Nothing

End Sub